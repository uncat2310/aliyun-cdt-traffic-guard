import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const MIN_GZIP_BYTES = 256;

/** 预先序列化 + 压缩的响应体，同一份内容被多次请求时不再重复编码。 */
export async function createPayload(body, compress = true) {
  const gzipped = compress && body.length > MIN_GZIP_BYTES ? await gzip(body, { level: 6 }) : null;
  return { body, gzipped };
}
