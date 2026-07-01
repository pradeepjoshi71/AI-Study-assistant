export interface ZipFileEntry {
  filename: string;
  content: Buffer;
}

export function createZipArchive(files: ZipFileEntry[]): Buffer {
  const buffers: Buffer[] = [];
  const localHeaders: { offset: number; size: number; crc: number; filename: string; contentSize: number }[] = [];

  let currentOffset = 0;

  // Helper to compute CRC32 using polynomial 0xEDB88320
  function computeCRC32(buffer: Buffer): number {
    const crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[i] = c;
    }
    let crc = 0 ^ -1;
    for (let i = 0; i < buffer.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
  }

  // DOS date/time conversion helper
  function getDosTime(date: Date): { time: number; date: number } {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);
    const dosTime = (hours << 11) | (minutes << 5) | seconds;

    const year = date.getFullYear() - 1980;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dosDate = (year << 9) | (month << 5) | day;

    return { time: dosTime, date: dosDate };
  }

  const { time: dosTime, date: dosDate } = getDosTime(new Date());

  // 1. Build Local File Header + Content blocks
  for (const file of files) {
    const filenameBuffer = Buffer.from(file.filename, 'utf-8');
    const crc = computeCRC32(file.content);

    const lfh = Buffer.alloc(30 + filenameBuffer.length);
    lfh.writeUInt32LE(0x04034b50, 0); // Local file header signature
    lfh.writeUInt16LE(10, 4);          // Version needed to extract (1.0)
    lfh.writeUInt16LE(0, 6);           // General purpose bit flag
    lfh.writeUInt16LE(0, 8);           // Compression method (0 = Store)
    lfh.writeUInt16LE(dosTime, 10);    // Last mod file time
    lfh.writeUInt16LE(dosDate, 12);    // Last mod file date
    lfh.writeUInt32LE(crc, 14);        // CRC-32
    lfh.writeUInt32LE(file.content.length, 18); // Compressed size
    lfh.writeUInt32LE(file.content.length, 22); // Uncompressed size
    lfh.writeUInt16LE(filenameBuffer.length, 26); // Filename length
    lfh.writeUInt16LE(0, 28);          // Extra field length
    filenameBuffer.copy(lfh, 30);

    localHeaders.push({
      offset: currentOffset,
      size: lfh.length + file.content.length,
      crc,
      filename: file.filename,
      contentSize: file.content.length,
    });

    buffers.push(lfh);
    buffers.push(file.content);

    currentOffset += lfh.length + file.content.length;
  }

  const centralDirectoryOffset = currentOffset;
  let centralDirectorySize = 0;

  // 2. Build Central Directory headers
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const headerMeta = localHeaders[i];
    const filenameBuffer = Buffer.from(file.filename, 'utf-8');

    const cdh = Buffer.alloc(46 + filenameBuffer.length);
    cdh.writeUInt32LE(0x02014b50, 0); // Central directory header signature
    cdh.writeUInt16LE(20, 4);          // Version made by (2.0)
    cdh.writeUInt16LE(10, 6);          // Version needed to extract (1.0)
    cdh.writeUInt16LE(0, 8);           // General purpose bit flag
    cdh.writeUInt16LE(0, 10);          // Compression method (0 = Store)
    cdh.writeUInt16LE(dosTime, 12);    // Last mod file time
    cdh.writeUInt16LE(dosDate, 14);    // Last mod file date
    cdh.writeUInt32LE(headerMeta.crc, 16); // CRC-32
    cdh.writeUInt32LE(headerMeta.contentSize, 20); // Compressed size
    cdh.writeUInt32LE(headerMeta.contentSize, 24); // Uncompressed size
    cdh.writeUInt16LE(filenameBuffer.length, 28); // Filename length
    cdh.writeUInt16LE(0, 30);          // Extra field length
    cdh.writeUInt16LE(0, 32);          // File comment length
    cdh.writeUInt16LE(0, 34);          // Disk number start
    cdh.writeUInt16LE(0, 36);          // Internal file attributes
    cdh.writeUInt32LE(0, 38);          // External file attributes
    cdh.writeUInt32LE(headerMeta.offset, 42); // Relative offset of local header
    filenameBuffer.copy(cdh, 46);

    buffers.push(cdh);
    centralDirectorySize += cdh.length;
  }

  // 3. Build End of Central Directory (EOCD) Record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);           // Number of this disk
  eocd.writeUInt16LE(0, 6);           // Disk where central directory starts
  eocd.writeUInt16LE(files.length, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(files.length, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralDirectorySize, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirectoryOffset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);          // Comment length

  buffers.push(eocd);

  return Buffer.concat(buffers);
}
