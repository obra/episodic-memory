// Executes production modules with child_process and IO replaced at the boundary.
// Removing windowsHide from any of the six launch sites must fail this test.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const readline = require('node:readline');
const ts = require('typescript');
const root = process.argv[2];
const report = [];
const watchdog=setTimeout(()=>{console.error('test suite did not complete');process.exit(2)},15000);
const normalize = value => JSON.parse(JSON.stringify(value));
function compile(path) {
 const source = fs.readFileSync(root + '/' + path, 'utf8');
 const result = ts.transpileModule(source, {fileName:path, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
 const errors=(result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,'transpile errors');
 return result.outputText;
}
function context(path, spawn, extra={}) {
 const exports = {};
 const env = {PATH:'fixture-path',EPISODIC_MEMORY_API_BASE_URL:'https://fixture.invalid',EPISODIC_MEMORY_API_TOKEN:'fixture-token',EPISODIC_MEMORY_API_TIMEOUT_MS:'9876'};
 const modules = {
  'child_process':{spawn}, 'readline':readline, 'fs':{},
  '@anthropic-ai/claude-agent-sdk':{query(){throw Error('SDK forbidden')}},
  './constants.js':{SUMMARIZER_CONTEXT_MARKER:'fixture-marker'}, './version.js':{VERSION:'1.6.0'},
  './codex-support.js':{parseCodexCliVersion:s=>s.includes('0.1.0')?'0.1.0':undefined,versionMeetsMinimum:()=>false,codexVersionRequirementMessage:()=> 'unsupported fixture version'},
  './codex-executable.js':{resolveCodexExecutable:()=>undefined},
  ...extra.modules
 };
 const fakeProcess={env,argv:['fixture-node','fixture-sync','--background','--only','codex','--summary-limit','2'],execPath:'fixture-node',pid:123,exit(code){throw Object.assign(Error('test exit'),{exitCode:code})}};
 const sandbox={exports,require(name){if(!(name in modules)) throw Error('Unmocked import '+name); return modules[name]},process:fakeProcess,console:{log(){},error(){}},setTimeout,clearTimeout,Buffer};
 return {exports,env,run:()=>new vm.Script('(async function(){'+compile(path)+'\n})()', {filename:path}).runInNewContext(sandbox)};
}
function child() {
 const c=new EventEmitter(); c.stdout=new PassThrough(); c.stderr=new PassThrough(); c.stdin=new PassThrough(); c.killed=false; c.kill=()=>{c.killed=true}; c.unref=()=>{c.unreferenced=true}; return c;
}
async function summarizer(path, mode) {
 const calls=[];
 const ctx=context(path,(command,args,options)=>{
  calls.push({command,args:normalize(args),options:normalize(options)});
  const c=child();
  queueMicrotask(()=>{if(mode==='version'){c.stdout.write('codex-cli 0.1.0');c.emit('exit',0)}else c.emit('error',Error('fixture stop'));});
  return c;
 });
 await ctx.run();
 const command={command:'fixture-codex',args:['app-server','--listen','stdio://'],versionArgs:['--version'],sessionId:'synthetic-session',prompt:'synthetic prompt',skipVersionCheck:mode==='app'};
 await assert.rejects(ctx.exports.runCodexCommand(command),mode==='version'?/unsupported fixture version/:/fixture stop/);
 assert.equal(calls.length,1);
 const call=calls[0];
 assert.equal(call.command,'fixture-codex');
 assert.deepEqual(call.args,mode==='version'?['--version']:['app-server','--listen','stdio://']);
 assert.deepEqual(call.options.stdio,mode==='version'?['ignore','pipe','pipe']:['pipe','pipe','pipe']);
 assert.deepEqual(call.options.env,{PATH:'fixture-path',EPISODIC_MEMORY_API_BASE_URL:'https://fixture.invalid',EPISODIC_MEMORY_API_TOKEN:'fixture-token',EPISODIC_MEMORY_API_TIMEOUT_MS:'9876',EPISODIC_MEMORY_SUMMARIZER_GUARD:'1',ANTHROPIC_BASE_URL:'https://fixture.invalid',ANTHROPIC_AUTH_TOKEN:'fixture-token',API_TIMEOUT_MS:'9876'});
 assert.equal(call.options.windowsHide,true,'windowsHide must be true');
}
async function sync(path) {
 const calls=[]; let c;
 const ctx=context(path,(command,args,options)=>{calls.push({command,args:normalize(args),options:normalize(options)});c=child();return c},{modules:{
  './sync.js':{},'./paths.js':{},'./summarizer.js':{shouldSkipReentrantSync:()=>false},'./db.js':{},'./embeddings.js':{},'./embedding-migration.js':{},'./opencode-sync.js':{},'./file-lock.js':{},
  './logging.js':{getSyncLogPath:()=> 'fixture.log',formatLogLine:()=> 'fixture line'},
  fs:{openSync:(path,mode)=>{assert.equal(path,'fixture.log');assert.equal(mode,'a');return 42},writeSync:(fd)=>assert.equal(fd,42)}
 }});
 await assert.rejects(ctx.run(),e=>e.exitCode===0);
 assert.equal(calls.length,1); assert.equal(calls[0].command,'fixture-node');
 assert.deepEqual(calls[0].args,['fixture-sync','--only','codex','--summary-limit','2']);
 assert.deepEqual(calls[0].options.stdio,['ignore',42,42]);
 assert.equal(calls[0].options.detached,true); assert.equal('env' in calls[0].options,false); assert.equal(c.unreferenced,true);
 assert.equal(calls[0].options.windowsHide,true,'windowsHide must be true');
}
(async()=>{
 for(const path of ['src/summarizer.ts','dist/summarizer.js']) for(const mode of ['version','app']) {
  try{await summarizer(path,mode);report.push({path,mode,pass:true})}catch(e){report.push({path,mode,pass:false,error:e.message})}
 }
 for(const path of ['src/sync-cli.ts','dist/sync-cli.js']) {
  try{await sync(path);report.push({path,mode:'background',pass:true})}catch(e){report.push({path,mode:'background',pass:false,error:e.message})}
 }
 clearTimeout(watchdog);
 console.log(JSON.stringify({root,tests:report,passed:report.filter(t=>t.pass).length,failed:report.filter(t=>!t.pass).length,realChildrenLaunched:0},null,2));
 process.exitCode=report.some(t=>!t.pass)?1:0;
})().catch(e=>{console.error(e);process.exitCode=2});
