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
  constructor({reservedEntries = 0, reservedBytes = 0} = {}) {
    if (!Number.isSafeInteger(reservedEntries) || reservedEntries < 0 || reservedEntries > 65535 || !Number.isSafeInteger(reservedBytes) || reservedBytes < 0 || reservedBytes > 0xffffffff) throw new Error('Invalid ZIP reservation');
    this.files = [];
    this.reservedEntries = reservedEntries;
    this.reservedBytes = reservedBytes;
  }

  releaseReservedSpace() { this.reservedEntries = 0; this.reservedBytes = 0; }

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

    this.validateEntry(cleanPath, bytes.length);
    this.files.push({
      path: cleanPath,
      bytes,
      crc: crc32(bytes),
      size: bytes.length,
    });
  }

  validateEntry(path, size) {
    if (!path || path.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f]/.test(path)) throw new Error('Invalid ZIP path');
    if (!Number.isSafeInteger(size) || size < 0 || new TextEncoder().encode(path).length > 65535 || size > 0xffffffff || this.files.length + this.reservedEntries >= 65535) throw new Error('Classic ZIP capacity exceeded');
    if (this.files.some(file => file.path === path)) throw new Error('Duplicate ZIP path');
    const total = this.files.reduce((sum,file)=>sum+file.size+76+new TextEncoder().encode(file.path).length*2,22);
    if (total+size+76+new TextEncoder().encode(path).length*2+this.reservedBytes>0xffffffff) throw new Error('Classic ZIP capacity exceeded');
  }

  async addBlob(path, blob) {
    this.validateEntry(path, blob.size);
    let crc = 0xffffffff;
    const reader = blob.stream().getReader();
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      for (const byte of value) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
    }
    this.files.push({path, blob, crc:(crc ^ 0xffffffff) >>> 0, size:blob.size});
  }

  // Header buffers and existing file Blobs remain separate; no archive-sized copy.
  parts() {
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
      if (offset + 30 + nameLen + dataLen > 0xffffffff) throw new Error('Classic ZIP capacity exceeded');
      const localHdr = new Uint8Array(30 + nameLen);
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
      localHeaders.push(localHdr, file.blob || file.bytes);

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

      offset += localHdr.length + dataLen;
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

    const totalSize = offset + cdSize + 22;
    if (totalSize > 0xffffffff) throw new Error('Classic ZIP capacity exceeded');
    return {chunks:[...localHeaders, ...centralEntries, eocd], totalSize};
  }

  toBlob() {
    return new Blob(this.parts().chunks, {type:'application/zip'});
  }

  // Compatibility for callers with byte-array entries, including existing tests.
  build() {
    const {chunks, totalSize} = this.parts();
    const result = new Uint8Array(totalSize);
    let cur = 0;
    for (const chunk of chunks) {
      if (chunk instanceof Blob) throw new Error('Use toBlob for Blob ZIP entries');
      result.set(chunk, cur);
      cur += chunk.length;
    }
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
