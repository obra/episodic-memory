// Synthetic app-server protocol only. No model or user files are accessed.
if (process.env.SYNTHETIC_EXPECT_ARGV0 && process.argv0 !== process.env.SYNTHETIC_EXPECT_ARGV0) throw Error('changed app-server argv0');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  const m = JSON.parse(line);
  const reply = result => console.log(JSON.stringify({ id: m.id, result }));
  if (m.method === 'initialize') return reply({});
  if (m.method === 'initialized') return;
  if (m.method === 'thread/fork') {
    if (!m.params.ephemeral || !m.params.excludeTurns || m.params.sandbox !== 'read-only' || m.params.approvalPolicy !== 'never') throw Error('unsafe fork');
    return reply({ thread: { id: 'synthetic-fork' } });
  }
  if (m.method === 'turn/start') {
    if (m.params.threadId !== 'synthetic-fork') throw Error('wrong fork');
    reply({ turn: { id: 'synthetic-turn' } });
    console.log(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'synthetic summary' } }));
    console.log(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'synthetic-turn', status: 'completed' } } }));
  }
});
