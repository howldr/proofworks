/**
 * howldr ProofWorks
 * Minimal ZIP writer (store method, no compression)
 *
 * Dependency-free builder for the evidence-pack export. Uses the "store"
 * method deliberately: pack contents are mostly PDFs/DOCX (already
 * compressed), and store-only keeps this ~100 lines with no external deps.
 * 32-bit ZIP only (fine — individual evidence files are far below 4 GB);
 * entry names are flagged UTF-8.
 */

// Standard CRC-32 (IEEE 802.3), table-driven.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time encoding used by ZIP headers. */
function dosDateTime(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day  = ((Math.max(0, d.getFullYear() - 1980)) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

const FLAG_UTF8 = 0x0800;

/**
 * Build a ZIP archive in memory.
 *
 * @param {Array<{name: string, data: Buffer|string, mtime?: Date}>} entries
 * @returns {Buffer} the archive
 */
function buildZip(entries) {
  const locals  = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const name = Buffer.from(entry.name, 'utf8');
    const crc  = crc32(data);
    const { time, day } = dosDateTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);       // local file header signature
    local.writeUInt16LE(20, 4);               // version needed
    local.writeUInt16LE(FLAG_UTF8, 6);        // general purpose flags
    local.writeUInt16LE(0, 8);                // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);     // compressed size (= raw: store)
    local.writeUInt32LE(data.length, 22);     // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);               // extra length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);     // central directory signature
    central.writeUInt16LE(20, 4);             // version made by
    central.writeUInt16LE(20, 6);             // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10);             // method: store
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra/comment/disk/attrs all zero (30..37)
    central.writeUInt32LE(0, 38);             // external attrs
    central.writeUInt32LE(offset, 42);        // local header offset

    locals.push(local, name, data);
    centrals.push(Buffer.concat([central, name]));
    offset += local.length + name.length + data.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);          // end of central directory
  eocd.writeUInt16LE(entries.length, 8);      // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);     // entries total
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);             // central directory offset
  // comment length 0 (20..21)

  return Buffer.concat([...locals, centralDir, eocd]);
}

module.exports = { buildZip, crc32 };
