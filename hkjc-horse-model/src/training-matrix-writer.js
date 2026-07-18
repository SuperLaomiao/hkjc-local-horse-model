import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import { iteratePreparedTrainingMatrixLines } from './training-dataset.js';

export async function writeTrainingMatrixAtomically({
  outputPath,
  format,
  matrix,
  highWaterMark,
  createWriteStreamFn = createWriteStream,
  renameFn = rename,
  rmFn = rm,
} = {}) {
  const directory = path.dirname(outputPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await mkdir(directory, { recursive: true });
  try {
    const writeStreamOptions = {
      encoding: 'utf8',
      ...(highWaterMark == null ? {} : { highWaterMark }),
    };
    await pipeline(
      Readable.from(iteratePreparedTrainingMatrixLines(matrix, format)),
      createWriteStreamFn(temporaryPath, writeStreamOptions),
    );
    await renameFn(temporaryPath, outputPath);
  } catch (error) {
    await rmFn(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
