/**
 * A simple implementation of the Aho-Corasick algorithm for efficient multi-pattern matching.
 */
class AhoCorasick {
  constructor(keywords) {
    this.trie = [{ next: {}, fail: 0, output: [] }];
    this.buildTrie(keywords);
    this.buildFailLinks();
  }

  buildTrie(keywords) {
    for (const keyword of keywords) {
      let node = 0;
      for (const char of keyword.toLowerCase()) {
        if (!this.trie[node].next[char]) {
          this.trie[node].next[char] = this.trie.length;
          this.trie.push({ next: {}, fail: 0, output: [] });
        }
        node = this.trie[node].next[char];
      }
      this.trie[node].output.push(keyword);
    }
  }

  buildFailLinks() {
    const queue = [];
    for (const char in this.trie[0].next) {
      queue.push(this.trie[0].next[char]);
    }

    while (queue.length > 0) {
      const u = queue.shift();
      for (const char in this.trie[u].next) {
        const v = this.trie[u].next[char];
        let fail = this.trie[u].fail;
        while (fail > 0 && !this.trie[fail].next[char]) {
          fail = this.trie[fail].fail;
        }
        this.trie[v].fail = this.trie[fail].next[char] || 0;
        this.trie[v].output = [...this.trie[v].output, ...this.trie[this.trie[v].fail].output];
        queue.push(v);
      }
    }
  }

  search(text) {
    const results = new Map(); // keyword -> count
    let node = 0;
    const lowerText = text.toLowerCase();

    for (const char of lowerText) {
      while (node > 0 && !this.trie[node].next[char]) {
        node = this.trie[node].fail;
      }
      node = this.trie[node].next[char] || 0;
      for (const keyword of this.trie[node].output) {
        results.set(keyword, (results.get(keyword) ?? 0) + 1);
      }
    }
    return results;
  }
}

module.exports = AhoCorasick;
