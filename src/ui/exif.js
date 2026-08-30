// Minimal EXIF orientation reader for JPEG files. PNG/WEBP have no EXIF
// orientation concept in the same sense, so callers just get 1 (normal)
// for anything that isn't a JPEG with a parseable APP1 segment.

const ORIENTATION_TAG = 0x0112;

export async function readExifOrientation(file) {
  if (file.type !== "image/jpeg") return 1;

  try {
    // The APP1/EXIF segment is always near the start of the file.
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(head);

    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      offset += 2;

      if (marker === 0xffd9 || marker === 0xffda) break; // EOI / start of scan
      if ((marker & 0xff00) !== 0xff00) break; // not a marker, bail

      const segmentLength = view.getUint16(offset);
      if (segmentLength < 2) break;

      if (marker === 0xffe1) {
        const orientation = readOrientationFromApp1(view, offset + 2, segmentLength - 2);
        if (orientation) return orientation;
      }

      offset += segmentLength;
    }
  } catch {
    // Fall through to default orientation.
  }

  return 1;
}

function readOrientationFromApp1(view, start, length) {
  if (length < 8) return null;
  // "Exif\0\0"
  if (
    view.getUint8(start) !== 0x45 ||
    view.getUint8(start + 1) !== 0x78 ||
    view.getUint8(start + 2) !== 0x69 ||
    view.getUint8(start + 3) !== 0x66
  ) {
    return null;
  }

  const tiffStart = start + 6;
  const byteOrderMark = view.getUint16(tiffStart);
  const littleEndian = byteOrderMark === 0x4949; // "II"
  if (!littleEndian && byteOrderMark !== 0x4d4d) return null; // not "MM" either

  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  const entriesOffset = tiffStart + ifd0Offset;
  if (entriesOffset + 2 > view.byteLength) return null;

  const entryCount = view.getUint16(entriesOffset, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = entriesOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === ORIENTATION_TAG) {
      const value = view.getUint16(entryOffset + 8, littleEndian);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }

  return null;
}
