import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { signRpc, percentEncode, ecsEndpoint, rpcRequest, transport, queryEcsInfo, AliyunApiError } from '../src/aliyun.js';

// 以下签名由官方 aliyun-python-sdk-core 对同样参数生成（secret = "testsecret"）
const SDK_VECTORS = [
  ['/?Version=2021-08-13&Action=ListCdtInternetTraffic&Format=JSON&RegionId=cn-hongkong&Timestamp=2026-10-17T03%3A36%3A16Z&SignatureMethod=HMAC-SHA1&SignatureType=&SignatureVersion=1.0&SignatureNonce=241d6540b1e1fe43b06335cc9a6039bf&AccessKeyId=testid', 'kzkptWNG2dWMYBiMMln6k0RBKnQ='],
  ['/?RegionId=cn-hongkong&PageSize=50&Version=2016-04-28&Action=DescribeCommonBandwidthPackages&Format=JSON&Timestamp=2026-10-17T03%3A36%3A16Z&SignatureMethod=HMAC-SHA1&SignatureType=&SignatureVersion=1.0&SignatureNonce=38e6c4b697ba145d718615b69f2e894f&AccessKeyId=testid', '1jRNsPTcq6quD46ZLAdfAfqcZig='],
  ['/?InstanceIds=%5B%27i-abc%27%5D&Version=2014-05-26&Action=DescribeInstances&Format=JSON&RegionId=cn-hongkong&Timestamp=2026-10-17T03%3A36%3A16Z&SignatureMethod=HMAC-SHA1&SignatureType=&SignatureVersion=1.0&SignatureNonce=2faca2087d024bd6a6dc7d1c052876fe&AccessKeyId=testid', 'eTY67lE4UaZmqaM7Clbgqa1ybJE='],
  ['/?ForceStop=False&InstanceId.1=i-abc&Version=2014-05-26&Action=StopInstances&Format=JSON&RegionId=cn-hongkong&Timestamp=2026-10-17T03%3A36%3A16Z&SignatureMethod=HMAC-SHA1&SignatureType=&SignatureVersion=1.0&SignatureNonce=1e3120d06ef5628333cb4eac63fb6e82&AccessKeyId=testid', '0GG5fmi18uGZgNESB5ztT8zhVok='],
];

test('signRpc matches the official SDK', () => {
  for (const [query, expected] of SDK_VECTORS) {
    const params = Object.fromEntries(new URLSearchParams(query.slice(2)));
    assert.equal(signRpc('POST', params, 'testsecret'), expected, params.Action);
  }
});

test('percentEncode follows RFC 3986', () => {
  assert.equal(percentEncode("a b*~!'()/="), "a%20b%2A~%21%27%28%29%2F%3D");
});

test('ECS endpoints', () => {
  assert.equal(ecsEndpoint('cn-hongkong'), 'ecs.cn-hongkong.aliyuncs.com');
  assert.equal(ecsEndpoint('cn-hangzhou'), 'ecs-cn-hangzhou.aliyuncs.com');
  assert.equal(transport.baseUrl('x.aliyuncs.com'), 'https://x.aliyuncs.com');
});

async function withFakeAliyun(handler, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req);
    const [code, body] = handler(req, requests.length);
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const original = transport.baseUrl;
  transport.baseUrl = () => `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(requests);
  } finally {
    transport.baseUrl = original;
    server.close();
  }
}

const CFG = { ak: 'testid', sk: 'testsecret', region_id: 'cn-hongkong', instance_id: 'i-abc', name: 'HK', ip: '1.2.3.4' };

test('rpcRequest sends a correctly signed request', async () => {
  await withFakeAliyun(() => [200, { Instances: { Instance: [{ Status: 'Running', Memory: 4096, PublicIpAddress: { IpAddress: ['5.6.7.8'] } }] } }], async (requests) => {
    const ecs = await queryEcsInfo(CFG);
    assert.equal(ecs.status, 'Running');
    assert.equal(ecs.memory, 4);
    assert.deepEqual(ecs.public_ips, ['1.2.3.4', '5.6.7.8']);
    const req = requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['x-acs-action'], 'DescribeInstances');
    const params = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    assert.equal(params.InstanceIds, '["i-abc"]');
    const { Signature, ...rest } = params;
    assert.equal(signRpc('POST', rest, 'testsecret'), Signature);
  });
});

test('rpcRequest does not retry client errors and retries server errors', async () => {
  await withFakeAliyun(() => [403, { Code: 'Forbidden.RAM', Message: 'no', RequestId: 'r1' }], async (requests) => {
    await assert.rejects(rpcRequest(CFG, { endpoint: 'x', version: 'v', action: 'A' }), (e) => e instanceof AliyunApiError && e.code === 'Forbidden.RAM');
    assert.equal(requests.length, 1);
  });
  await withFakeAliyun((req, n) => (n < 3 ? [503, { Code: 'ServiceUnavailable' }] : [200, { ok: 1 }]), async (requests) => {
    assert.deepEqual(await rpcRequest(CFG, { endpoint: 'x', version: 'v', action: 'A' }), { ok: 1 });
    assert.equal(requests.length, 3);
  });
});
