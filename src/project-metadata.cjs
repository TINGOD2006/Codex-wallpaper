const fs = require('node:fs/promises');

const MAX_BYTES = 1024 * 1024;

function tooLarge() {
  return Object.assign(new Error('Project metadata exceeds 1 MiB'), {code: 'METADATA_TOO_LARGE'});
}

// The caller supplies the fenced project.json path. Keep the original bytes
// and the stamp from this same handle for callers that fingerprint the project.
async function readProjectMetadata(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stamp = await handle.stat();
    if (stamp.size > MAX_BYTES) throw tooLarge();
    let buffer = Buffer.alloc(stamp.size + 1);
    let length = 0;
    for (;;) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > MAX_BYTES) throw tooLarge();
      if (length === buffer.length) {
        // The file grew after stat. Allow growth within the original limit.
        const expanded = Buffer.alloc(MAX_BYTES + 1);
        buffer.copy(expanded, 0, 0, length);
        buffer = expanded;
      }
    }
    const bytes = buffer.subarray(0, length);
    const project = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    return {file, stamp, bytes, project};
  } finally {
    await handle.close();
  }
}

module.exports = {readProjectMetadata};
