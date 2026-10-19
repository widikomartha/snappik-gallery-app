// Separate killable process: never decode untrusted originals in the web process.
import sharp from "sharp";
sharp.cache(false); sharp.concurrency(1);
try {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length; if (size > 52428800) throw Error(); chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  const options = { limitInputPixels: 24000000, failOn: "warning", animated: false, sequentialRead: true };
  const metadata = await sharp(input, options).metadata();
  const expected = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[process.argv[2]];
  if (!expected || metadata.format !== expected || (metadata.pages ?? 1) !== 1) throw Error();
  const output = await sharp(input, options).timeout({seconds:5}).rotate().resize({width:1024,height:1024,fit:"inside",withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
  if (output.length > 524288) throw Error();
  process.stdout.end(output);
} catch { process.exitCode = 2; }
