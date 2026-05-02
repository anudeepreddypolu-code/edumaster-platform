import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const argv = process.argv.slice(2);
if (argv.length < 3) {
  console.error('Usage: tsx src/visual-diff.ts <baseline.png> <variant.png> <out-diff.png>');
  process.exit(2);
}

const [baselinePath, variantPath, outPath] = argv;

const readPng = (p: string) => new Promise<PNG>((resolve, reject) => {
  fs.createReadStream(p)
    .pipe(new PNG())
    .on('parsed', function () {
      resolve(this as PNG);
    })
    .on('error', reject);
});

(async () => {
  try {
    const base = await readPng(baselinePath);
    const varn = await readPng(variantPath);

    const width = Math.max(base.width, varn.width);
    const height = Math.max(base.height, varn.height);

    const baseResized = new PNG({ width, height, fill: true });
    const varResized = new PNG({ width, height, fill: true });

    base.bitblt(baseResized, 0, 0, base.width, base.height, 0, 0);
    varn.bitblt(varResized, 0, 0, varn.width, varn.height, 0, 0);

    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(
      baseResized.data,
      varResized.data,
      diff.data,
      width,
      height,
      { threshold: 0.15 }
    );

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    diff.pack().pipe(fs.createWriteStream(outPath));

    console.log(`Diff complete: ${diffPixels} different pixels -> ${outPath}`);
    process.exit(0);
  } catch (err) {
    console.error('Visual diff failed:', err);
    process.exit(1);
  }
})();
