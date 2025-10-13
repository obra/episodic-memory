import { searchConversations, formatResults, SearchOptions } from './search.js';

const query = process.argv[2];
const mode = (process.argv[3] || 'vector') as 'vector' | 'text' | 'both';
const limit = parseInt(process.argv[4] || '10');
const after = process.argv[5] || undefined;
const before = process.argv[6] || undefined;

if (!query) {
  console.error('Usage: search-conversations <query> [mode] [limit] [after] [before]');
  process.exit(1);
}

const options: SearchOptions = {
  mode,
  limit,
  after,
  before
};

searchConversations(query, options)
  .then(results => {
    console.log(formatResults(results));
  })
  .catch(error => {
    console.error('Error searching:', error);
    process.exit(1);
  });
