import { readExifOrientation } from "./exif.js";

// Decodes a File into pixel data, correcting for EXIF orientation so that
// downstream vision/analysis code always receives an upright image.
// Orientation is applied manually via a canvas transform rather than relying
// on `createImageBitmap`'s `imageOrientation` option, since that option is
// applied inconsistently across browsers.
export async function decodeImageFile(file) {
  const orientation = await readExifOrientation(file);

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new Error("Could not decode this image. The file may be corrupted or unsupported.");
  }

  const { width: srcWidth, height: srcHeight } = bitmap;
  const swapped = orientation >= 5 && orientation <= 8;

  const canvas = document.createElement("canvas");
  canvas.width = swapped ? srcHeight : srcWidth;
  canvas.height = swapped ? srcWidth : srcHeight;

  const ctx = canvas.getContext("2d");
  applyOrientationTransform(ctx, orientation, srcWidth, srcHeight);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageBitmap = await createImageBitmap(canvas);

  return {
    imageData,
    canvas,
    imageBitmap,
    width: canvas.width,
    height: canvas.height,
    orientation,
  };
}

function applyOrientationTransform(ctx, orientation, width, height) {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break; // orientation 1, or unknown: no transform
  }
}
