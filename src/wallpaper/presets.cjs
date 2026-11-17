const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {atomicJson} = require('../config.cjs');
const {defaults, mergeSettings, validateSettings} = require('./schema.cjs');

const groups = ['wallpaper', 'reading', 'materials', 'colors', 'playback'];
const appearanceKeys = [...groups].sort().join(',');
const userId = /^user:[\da-f-]{36}$/;
const userFileName = /^[\da-f-]{36}\.json$/;
const maxFileBytes = 2 * 1024 * 1024;
const namesOrder = new Intl.Collator('zh-Hant', {numeric: true});

function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 64 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new Error('名稱須為 1–64 字元且不含控制字元');
  }
  return name.trim();
}

function appearance(settings) {
  const valid = validateSettings(settings);
  return Object.fromEntries(groups.map(key => [key, valid[key]]));
}

function parseDocument(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'appearance,name,schemaVersion' ||
      value.schemaVersion !== 1 || !value.appearance || Object.keys(value.appearance).sort().join(',') !== appearanceKeys) {
    throw new Error('無效的 Wallpaper 方案');
  }
  return {schemaVersion: 1, name: validName(value.name), appearance: appearance(mergeSettings(defaults(), value.appearance))};
}

function readDocument(file) {
  return fs.readFile(file, 'utf8').then(text => parseDocument(JSON.parse(text.replace(/^\uFEFF/, ''))));
}

function builtinPresets() {
  const normal = defaults();
  const reading = mergeSettings(normal, {reading: {scrim: .94}});
  return new Map([
    ['builtin:native', {schemaVersion: 1, name: '原生＋桌布', appearance: appearance(normal)}],
    ['builtin:reading', {schemaVersion: 1, name: '閱讀優先', appearance: appearance(reading)}],
  ]);
}

function createPresets({dataRoot, store, library}) {
  const root = path.join(dataRoot, 'presets');
  const builtins = builtinPresets();
  const documents = new Map();
  let tail = Promise.resolve();

  function serial(work) {
    const job = tail.then(work);
    tail = job.catch(() => {});
    return job;
  }
  function fileName(id) {
    if (!userId.test(id)) throw new Error('找不到方案');
    return id.slice(5) + '.json';
  }
  function removedName(id) {
    return '.' + id.replace(':', '-') + '.removed.json';
  }
  function optionalMissing(error) {
    if (error.code !== 'ENOENT') throw error;
  }

  async function read(id) {
    const builtin = builtins.get(id);
    if (builtin) {
      const removed = await fs.access(path.join(root, removedName(id))).then(() => true, optionalMissing);
      if (removed) throw new Error('找不到方案');
      return builtin;
    }
    const file = path.join(root, fileName(id));
    const stat = await fs.stat(file, {bigint: true}).catch(optionalMissing);
    if (!stat?.isFile()) throw new Error('找不到方案');
    if (stat.size > maxFileBytes) throw new Error('方案超過 2 MiB');
    const fingerprint = [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    const cached = documents.get(id);
    if (cached?.fingerprint === fingerprint) return cached.doc;
    const doc = await readDocument(file);
    documents.set(id, {fingerprint, doc});
    return doc;
  }

  async function saveDoc(doc) {
    const id = 'user:' + randomUUID();
    await atomicJson(path.join(root, fileName(id)), doc);
    return {id, name: doc.name, builtin: false};
  }

  function list() {
    return serial(async () => {
      const names = new Set(await fs.readdir(root).catch(optionalMissing));
      const local = [];
      for (const id of documents.keys()) {
        if (!names.has(fileName(id))) documents.delete(id);
      }
      for (const name of names) {
        if (!userFileName.test(name)) continue;
        const id = 'user:' + name.slice(0, -5);
        try { local.push([id, await read(id)]); }
        catch { documents.delete(id); }
      }
      local.sort(([leftId, left], [rightId, right]) => namesOrder.compare(left.name, right.name) || leftId.localeCompare(rightId));
      const availableBuiltins = [...builtins].filter(([id]) => !names.has(removedName(id)));
      return [...availableBuiltins, ...local].map(([id, doc]) => {
        const selected = doc.appearance.wallpaper.selectedId;
        return {id, name: doc.name, builtin: builtins.has(id), missing: !!selected && !library.get(selected)};
      });
    });
  }

  return {
    list,
    save(name, settings) {
      return serial(() => saveDoc({schemaVersion: 1, name: validName(name), appearance: appearance(settings)}));
    },
    rename(id, name) {
      return serial(async () => {
        if (builtins.has(id)) throw new Error('內建方案不可改名');
        const doc = {...await read(id), name: validName(name)};
        await atomicJson(path.join(root, fileName(id)), doc);
        documents.delete(id);
        return {id, name: doc.name};
      });
    },
    remove(id) {
      return serial(async () => {
        if (builtins.has(id)) {
          await atomicJson(path.join(root, removedName(id)), {id});
        } else {
          await fs.unlink(path.join(root, fileName(id))).catch(optionalMissing);
          documents.delete(id);
        }
      });
    },
    resolve(id) {
      return serial(async () => {
        const doc = await read(id);
        const current = await store.load();
        const next = mergeSettings(current, doc.appearance);
        if (builtins.has(id)) next.wallpaper.selectedId = current.wallpaper.selectedId;
        next.enabled = true;
        next.presets.activeId = id;
        return next;
      });
    },
    importFile(source) {
      return serial(async () => {
        const stat = await fs.stat(source);
        if (stat.size > maxFileBytes) throw new Error('方案超過 2 MiB');
        return saveDoc(await readDocument(source));
      });
    },
    exportFile(id, target) {
      return serial(async () => {
        await atomicJson(target, await read(id));
        return {exported: true};
      });
    },
  };
}

module.exports = {createPresets};
