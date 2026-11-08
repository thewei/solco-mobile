import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pairRequestBody, pairTargetBaseUrl, pairTargetParams, parsePairParams, parsePairUrl } from '@/lib/pairing-v3';

const goldenUrl = readFileSync(
  join(import.meta.dirname, '..', 'contracts', '__fixtures__', 'v3', 'pair-url.txt'),
  'utf8',
).trim();

const FP = 'a1cc1d2af9c5a03eefb30bfcc11c5bae5554e2cee2ff007c8cde90e0a096ad57';
const CODE = 'DPXDTU4Q4AMMVTNB5ZOAGI2CHY';
const link = (query: string) => `solco://pair?${query}`;
const good = `h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&n=Test+Mac`;

describe('parsePairUrl', () => {
  it('reads the Go Host\'s own golden link', () => {
    expect(parsePairUrl(goldenUrl)).toEqual({
      host: '192.168.1.20',
      port: 7788,
      fingerprint: FP,
      code: 'AAAAAAAAAAAAAAAAAAAAAAAAAA',
      hostName: 'Test Mac',
    });
  });

  it('accepts IPv6 and DNS hosts, percent and plus encoded names, any key order, surrounding space', () => {
    expect(parsePairUrl(`  ${link(`n=%E6%88%91%E7%9A%84Mac&c=${CODE}&fp=${FP.toUpperCase()}&p=1&h=fd7a%3A115c%3Aa1e0%3A%3A1`)}  `)).toEqual({
      host: 'fd7a:115c:a1e0::1',
      port: 1,
      fingerprint: FP,
      code: CODE,
      hostName: '我的Mac',
    });
    expect(parsePairUrl(link(`h=mac.tail1234.ts.net&p=65535&fp=${FP}&c=${CODE}`))?.hostName).toBe('');
  });

  it.each([
    ['wrong scheme', `https://pair?${good}`],
    ['wrong target', `solco://other?${good}`],
    ['retired shardlane scheme', `shardlane://pair?host=1.2.3.4&port=8757&token=abc`],
    ['no query', 'solco://pair'],
    ['missing host', link(`p=7788&fp=${FP}&c=${CODE}`)],
    ['missing fingerprint', link(`h=192.168.1.20&p=7788&c=${CODE}`)],
    ['missing code', link(`h=192.168.1.20&p=7788&fp=${FP}`)],
    ['short fingerprint', link(`h=192.168.1.20&p=7788&fp=${FP.slice(2)}&c=${CODE}`)],
    ['non-hex fingerprint', link(`h=192.168.1.20&p=7788&fp=${'z'.repeat(64)}&c=${CODE}`)],
    ['code of the wrong alphabet', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${'1'.repeat(26)}`)],
    ['code of the wrong length', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${CODE.slice(1)}`)],
    ['port 0', link(`h=192.168.1.20&p=0&fp=${FP}&c=${CODE}`)],
    ['port 65536', link(`h=192.168.1.20&p=65536&fp=${FP}&c=${CODE}`)],
    ['port with junk', link(`h=192.168.1.20&p=77a8&fp=${FP}&c=${CODE}`)],
    ['IPv4 octet over 255', link(`h=192.168.1.256&p=7788&fp=${FP}&c=${CODE}`)],
    ['host with a path', link(`h=evil.com/x&p=7788&fp=${FP}&c=${CODE}`)],
    ['host with credentials', link(`h=user%40evil.com&p=7788&fp=${FP}&c=${CODE}`)],
    ['host with spaces', link(`h=a%20b&p=7788&fp=${FP}&c=${CODE}`)],
    ['duplicated key (a second one could swap the host)', link(`${good}&h=6.6.6.6`)],
    ['bad percent escape', link(`h=%E0%A4%A&p=7788&fp=${FP}&c=${CODE}`)],
    ['overlong name', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&n=${'x'.repeat(81)}`)],
  ])('refuses %s', (_name, url) => {
    expect(parsePairUrl(url)).toBeNull();
  });
});

describe('pair builders', () => {
  it('base URL is https only and brackets IPv6', () => {
    expect(pairTargetBaseUrl({ host: '192.168.1.20', port: 7788 })).toBe('https://192.168.1.20:7788');
    expect(pairTargetBaseUrl({ host: 'fd7a:115c:a1e0::1', port: 7788 })).toBe('https://[fd7a:115c:a1e0::1]:7788');
  });

  it('pair body carries the code and a bounded device name', () => {
    expect(JSON.parse(pairRequestBody({ code: CODE }, '  Pixel 8  '))).toEqual({ code: CODE, deviceName: 'Pixel 8' });
    expect(JSON.parse(pairRequestBody({ code: CODE }, 'x'.repeat(200))).deviceName).toHaveLength(80);
  });
});

describe('parsePairParams (deep-link route params)', () => {
  const params = { h: '192.168.1.20', p: '7788', fp: 'A'.repeat(64), c: 'A'.repeat(26), n: 'Test Mac' };

  it('accepts decoded params and agrees with the URL parser', () => {
    expect(parsePairParams(params)).toEqual({ host: '192.168.1.20', port: 7788, fingerprint: 'a'.repeat(64), code: 'A'.repeat(26), hostName: 'Test Mac' });
    const url = parsePairUrl(`solco://pair?h=192.168.1.20&p=7788&fp=${'A'.repeat(64)}&c=${'A'.repeat(26)}&n=Test+Mac`);
    expect(url).toEqual(parsePairParams(params));
  });

  it('refuses a repeated key (array), a missing field and bad values', () => {
    expect(parsePairParams({ ...params, h: ['1.1.1.1', '2.2.2.2'] })).toBeNull();
    expect(parsePairParams({ ...params, c: undefined })).toBeNull();
    expect(parsePairParams({ ...params, p: '70000' })).toBeNull();
    expect(parsePairParams({ ...params, fp: 'zz' })).toBeNull();
    expect(parsePairParams({})).toBeNull();
  });

  it('name is optional', () => {
    expect(parsePairParams({ ...params, n: undefined })?.hostName).toBe('');
  });
});

describe('relay link fields (r/rt)', () => {
  const relayUrl = 'https://relay.example.com';
  const secret = 'relsecret0123456789abcdef';
  const withRelay = `h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&n=Test+Mac&r=${encodeURIComponent(relayUrl)}&rt=${secret}`;

  it('merges the optional relay into the target, agreeing with the URL parser', () => {
    expect(parsePairUrl(link(withRelay))).toEqual({
      host: '192.168.1.20',
      port: 7788,
      fingerprint: FP,
      code: CODE,
      hostName: 'Test Mac',
      relay: { url: relayUrl, secret },
    });
    expect(parsePairParams({ h: '192.168.1.20', p: '7788', fp: FP, c: CODE, n: 'Test Mac', r: relayUrl, rt: secret })).toEqual(
      parsePairUrl(link(withRelay)),
    );
  });

  it('strips trailing slashes from the relay base', () => {
    const slashed = `h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&n=Test+Mac&r=${encodeURIComponent(`${relayUrl}/`)}&rt=${secret}`;
    expect(parsePairUrl(link(slashed))?.relay?.url).toBe(relayUrl);
  });

  it('stays byte-identical without r/rt', () => {
    expect(parsePairUrl(link(good))).toEqual({ host: '192.168.1.20', port: 7788, fingerprint: FP, code: CODE, hostName: 'Test Mac' });
  });

  it.each([
    ['r without rt', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&r=${encodeURIComponent(relayUrl)}`)],
    ['rt without r', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&rt=${secret}`)],
    ['non-https relay', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&r=http://relay.example.com&rt=${secret}`)],
    ['relay with a query', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&r=${encodeURIComponent('https://relay.example.com/?x=1')}&rt=${secret}`)],
    ['short secret', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&r=${encodeURIComponent(relayUrl)}&rt=short`)],
    ['secret with bad characters', link(`h=192.168.1.20&p=7788&fp=${FP}&c=${CODE}&r=${encodeURIComponent(relayUrl)}&rt=${'a!'.repeat(10)}`)],
    ['duplicated rt', link(`${withRelay}&rt=${secret}`)],
  ])('refuses %s', (_name, url) => {
    expect(parsePairUrl(url)).toBeNull();
  });
});

describe('pairTargetParams (scan → /pair route)', () => {
  const RT = 'x'.repeat(43);
  it('round-trips a relay link: the scan must not drop r/rt', () => {
    const target = parsePairUrl(link(`${good}&r=https%3A%2F%2Frelay.example.com&rt=${RT}`));
    expect(target?.relay).toEqual({ url: 'https://relay.example.com', secret: RT });
    expect(parsePairParams(pairTargetParams(target!))).toEqual(target);
  });

  it('a direct link stays direct', () => {
    const target = parsePairUrl(link(good));
    expect(pairTargetParams(target!)).not.toHaveProperty('r');
    expect(parsePairParams(pairTargetParams(target!))).toEqual(target);
  });
});

describe('tailcat link field (tc)', () => {
  const TC = 'tcpGFwWCB27eTym2U3yqUtdjZHe-qb_AxeWLR2moPLGw77mUniZWFrWCB71vij';
  it('merges the optional tunnel address into the target', () => {
    const target = parsePairUrl(link(`${good}&tc=${TC}&v=2`));
    expect(target?.tailcat).toBe(TC);
    expect(target?.relay).toBeUndefined();
  });

  it('round-trips through the route params so a scan never drops the tunnel', () => {
    const target = parsePairUrl(link(`${good}&tc=${TC}`));
    expect(pairTargetParams(target!)).toHaveProperty('tc', TC);
    expect(parsePairParams(pairTargetParams(target!))).toEqual(target);
  });

  it('a link without tc stays tunnel-less', () => {
    expect(parsePairUrl(link(good))?.tailcat).toBeUndefined();
  });

  it.each([
    ['too short', link(`${good}&tc=abc`)],
    ['bad characters', link(`${good}&tc=${'x'.repeat(30)};drop`)],
  ])('refuses a damaged tunnel address (%s)', (_name, url) => {
    expect(parsePairUrl(url)).toBeNull();
  });

  it('the pair body carries the tunnel client key when the bridge has one', () => {
    const target = parsePairUrl(link(good))!;
    expect(JSON.parse(pairRequestBody(target, 'Pixel', 'nodekey:' + 'a'.repeat(64)))).toMatchObject({
      code: target.code,
      clientKey: 'nodekey:' + 'a'.repeat(64),
    });
    expect(JSON.parse(pairRequestBody(target, 'Pixel'))).not.toHaveProperty('clientKey');
  });
});
