import { state } from "./config.js";

const DocManager = {
  key: "sunshade-docs",
  _cache: {},

  async init() {
    try {
      const fileData = await window.sunshadeAPI.loadIndex();
      if (fileData) {
        this._cache = JSON.parse(fileData);
        console.log(`Index loaded from file [sunshade-index.json]. Count: ${Object.keys(this._cache).length}`);
      } else {
        this._cache = {};
      }
      this.notifyUpdate();
    } catch (e) {
      console.error("Failed to init DocManager index:", e);
    }
  },

  getAll() {
    return this._cache;
  },

  async saveAll(docs) {
    try {
      this._cache = docs;
      await window.sunshadeAPI.saveIndex(JSON.stringify(docs, null, 2));
      console.log(`Index saved to [${state.userDataPath}/sunshade-index.json]. Count:`, Object.keys(docs).length);
    } catch (e) {
      console.error("Failed to save index:", e);
    }
  },

  get(path) {
    return this._cache[path] || null;
  },

  async getHeavy(path) {
    const doc = this.get(path);
    if (!doc || !doc.contentHash) return null;
    const raw = await window.sunshadeAPI.readContent(doc.contentHash);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse heavy content for', path, e);
      return null;
    }
  },

  async save(path, data) {
    const docs = this.getAll();
    const isNew = !docs[path];
    const newOrder = isNew
      ? Date.now()
      : docs[path].order ||
        docs[path].addedAt ||
        docs[path].lastOpened ||
        Date.now();

    const { extractedText, analysis, highlights, chatHistory, ...metaOnly } = data;
    const hasHeavyContent = extractedText !== undefined || analysis !== undefined || highlights !== undefined || chatHistory !== undefined;

    let contentHash = isNew ? null : docs[path].contentHash;

    async function sha256(message) {
      const msgBuffer = new TextEncoder().encode(message);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex;
    }

    if (!contentHash) {
      contentHash = await sha256(path + Date.now());
    }

    if (hasHeavyContent) {
      let existingHeavy = {};
      const existingRaw = await window.sunshadeAPI.readContent(contentHash);
      if (existingRaw) existingHeavy = JSON.parse(existingRaw);

      const newHeavy = {
        extractedText: extractedText !== undefined ? extractedText : existingHeavy.extractedText,
        analysis: analysis !== undefined ? analysis : existingHeavy.analysis,
        highlights: highlights !== undefined ? highlights : existingHeavy.highlights,
        chatHistory: chatHistory !== undefined ? chatHistory : existingHeavy.chatHistory,
      };

      await window.sunshadeAPI.saveContent(contentHash, JSON.stringify(newHeavy, null, 2));
    }

    const { extractedText: _1, analysis: _2, highlights: _3, chatHistory: _4, ...existingMeta } = docs[path] || {};

    docs[path] = {
      ...existingMeta,
      ...metaOnly,
      path,
      contentHash,
      lastOpened: Date.now(),
      order: newOrder,
    };
    await this.saveAll(docs);
    this.notifyUpdate();
  },

  async updateOrders(pathsInOrder) {
    const docs = this.getAll();
    pathsInOrder.forEach((path, index) => {
      if (docs[path]) {
        docs[path].order = pathsInOrder.length - index;
      }
    });
    await this.saveAll(docs);
    this.notifyUpdate();
  },

  async toggleFavorite(path) {
    const docs = this.getAll();
    if (docs[path]) {
      docs[path].isFavorite = !docs[path].isFavorite;
      await this.saveAll(docs);
      this.notifyUpdate();
      return docs[path].isFavorite;
    }
    return false;
  },

  async delete(path) {
    const docs = this.getAll();
    if (docs[path]) {
      const hash = docs[path].contentHash;
      if (hash) {
        await window.sunshadeAPI.deleteContent(hash);
      }
      delete docs[path];
      await this.saveAll(docs);
      this.notifyUpdate();
      console.log("Deleted doc from file:", path);
    } else {
      console.warn("Doc not found to delete:", path);
    }
  },

  async clearHistory() {
    const docs = this.getAll();
    let changed = false;
    let count = 0;
    const promises = [];
    Object.keys(docs).forEach((path) => {
      if (!docs[path].isFavorite) {
        if (docs[path].contentHash) {
          promises.push(window.sunshadeAPI.deleteContent(docs[path].contentHash));
        }
        delete docs[path];
        changed = true;
        count++;
      }
    });

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
    if (changed) {
      await this.saveAll(docs);
      this.notifyUpdate();
      console.log(`Cleared ${count} history items from file`);
    } else {
      console.log("No history items to clear");
    }
  },

  getList(filterType) {
    const docs = this.getAll();
    let list = Object.values(docs);
    if (filterType === "favorite") {
      list = list.filter((d) => d.isFavorite);
    }
    return list.sort(
      (a, b) =>
        (b.order || b.lastOpened || 0) - (a.order || a.lastOpened || 0),
    );
  },

  notifyUpdate() {
    window.dispatchEvent(new CustomEvent("doc-update"));
  },
};

export { DocManager };
