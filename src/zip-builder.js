// Simple, zero-dependency in-memory ZIP archive builder (PKZip standard)
// Supports UTF-8 filenames, arbitrary binary data, and subdirectories.

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < uint8Array.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ uint8Array[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear()) - 1980;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = (year << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

export class SimpleZip {
  constructor() {
    this.files = [];
  }

  // Add a file: data can be Uint8Array, string (UTF-8), or ArrayBuffer
  addFile(path, data) {
    const cleanPath = path.replace(/^[\\/]+/, "").replace(/\\+/g, "/");
    let bytes;
    if (typeof data === "string") {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      bytes = new Uint8Array(0);
    }

    this.files.push({
      path: cleanPath,
      bytes,
      crc: crc32(bytes),
      size: bytes.length,
    });
  }

  // Generates the final ZIP binary as a Uint8Array
  build() {
    const encoder = new TextEncoder();
    const { dosTime, dosDate } = dosDateTime();
    const localHeaders = [];
    const centralEntries = [];
    let offset = 0;

    for (const file of this.files) {
      const nameBytes = encoder.encode(file.path);
      const nameLen = nameBytes.length;
      const dataLen = file.size;

      // --- Local File Header (30 bytes + nameLen + dataLen) ---
      const localHdr = new Uint8Array(30 + nameLen + dataLen);
      const localView = new DataView(localHdr.buffer);

      localView.setUint32(0, 0x04034b50, true); // Local header signature
      localView.setUint16(4, 20, true);         // Version needed (2.0)
      localView.setUint16(6, 0x0800, true);     // Flags: UTF-8 filename (bit 11)
      localView.setUint16(8, 0, true);          // Method: Store (0)
      localView.setUint16(10, dosTime, true);   // Mod time
      localView.setUint16(12, dosDate, true);   // Mod date
      localView.setUint32(14, file.crc, true);  // CRC-32
      localView.setUint32(18, dataLen, true);   // Compressed size
      localView.setUint32(22, dataLen, true);   // Uncompressed size
      localView.setUint16(26, nameLen, true);   // Filename length
      localView.setUint16(28, 0, true);         // Extra field length

      localHdr.set(nameBytes, 30);
      localHdr.set(file.bytes, 30 + nameLen);

      localHeaders.push(localHdr);

      // --- Central Directory Header (46 bytes + nameLen) ---
      const cdHdr = new Uint8Array(46 + nameLen);
      const cdView = new DataView(cdHdr.buffer);

      cdView.setUint32(0, 0x02014b50, true); // Central header signature
      cdView.setUint16(4, 20, true);         // Version made by
      cdView.setUint16(6, 20, true);         // Version needed
      cdView.setUint16(8, 0x0800, true);     // Flags: UTF-8
      cdView.setUint16(10, 0, true);         // Method: Store
      cdView.setUint16(12, dosTime, true);   // Mod time
      cdView.setUint16(14, dosDate, true);   // Mod date
      cdView.setUint32(16, file.crc, true);  // CRC-32
      cdView.setUint32(20, dataLen, true);   // Compressed size
      cdView.setUint32(24, dataLen, true);   // Uncompressed size
      cdView.setUint16(28, nameLen, true);   // Filename length
      cdView.setUint16(30, 0, true);         // Extra length
      cdView.setUint16(32, 0, true);         // Comment length
      cdView.setUint16(34, 0, true);         // Disk start
      cdView.setUint16(36, 0, true);         // Internal attr
      cdView.setUint32(38, 0, true);         // External attr
      cdView.setUint32(42, offset, true);    // Local header offset

      cdHdr.set(nameBytes, 46);
      centralEntries.push(cdHdr);

      offset += localHdr.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const cd of centralEntries) {
      cdSize += cd.length;
    }

    // --- End of Central Directory Record (22 bytes) ---
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);

    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true);          // Disk number
    eocdView.setUint16(6, 0, true);          // Start disk
    eocdView.setUint16(8, this.files.length, true);  // Entries on this disk
    eocdView.setUint16(10, this.files.length, true); // Total entries
    eocdView.setUint32(12, cdSize, true);    // Size of central dir
    eocdView.setUint32(16, cdOffset, true);  // Offset of central dir
    eocdView.setUint16(20, 0, true);         // Comment length

    // Assemble all chunks into single Uint8Array
    const totalSize = offset + cdSize + 22;
    const result = new Uint8Array(totalSize);
    let cur = 0;

    for (const lh of localHeaders) {
      result.set(lh, cur);
      cur += lh.length;
    }
    for (const cd of centralEntries) {
      result.set(cd, cur);
      cur += cd.length;
    }
    result.set(eocd, cur);

    return result;
  }

  // Convert to Base64 Data URL for Chrome download
  toDataUrl() {
    const bytes = this.build();
    let binary = "";
    const len = bytes.byteLength;
    const chunkSize = 0x8000; // 32KB chunks for stack safety
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return "data:application/zip;base64," + btoa(binary);
  }
}
