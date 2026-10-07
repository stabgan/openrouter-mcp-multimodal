import { describe, it, expect } from 'vitest';
import { isBlockedIPv6, parseBase64DataUrl } from '../tool-handlers/fetch-utils.js';

describe('isBlockedIPv6 — comprehensive', () => {
  it('blocks loopback (::1) in canonical and compressed form', () => {
    expect(isBlockedIPv6('::1')).toBe(true);
    expect(isBlockedIPv6('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isBlockedIPv6('[::1]')).toBe(true);
  });

  it('blocks the unspecified address', () => {
    expect(isBlockedIPv6('::')).toBe(true);
    expect(isBlockedIPv6('0:0:0:0:0:0:0:0')).toBe(true);
  });

  it('blocks IPv4-mapped private ranges', () => {
    expect(isBlockedIPv6('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIPv6('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedIPv6('::ffff:192.168.1.1')).toBe(true);
    expect(isBlockedIPv6('::ffff:169.254.169.254')).toBe(true);
  });

  it('allows IPv4-mapped public addresses', () => {
    expect(isBlockedIPv6('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedIPv6('::ffff:1.1.1.1')).toBe(false);
  });

  it('blocks IPv4-compatible loopback', () => {
    expect(isBlockedIPv6('::127.0.0.1')).toBe(true);
  });

  it('blocks multicast (all forms)', () => {
    expect(isBlockedIPv6('ff00::1')).toBe(true);
    expect(isBlockedIPv6('ff02::1')).toBe(true);
    expect(isBlockedIPv6('ff0e::1')).toBe(true);
  });

  it('blocks link-local fe80::/10', () => {
    expect(isBlockedIPv6('fe80::1')).toBe(true);
    expect(isBlockedIPv6('febf::ffff')).toBe(true);
  });

  it('blocks site-local fec0::/10 (deprecated)', () => {
    expect(isBlockedIPv6('fec0::1')).toBe(true);
  });

  it('blocks ULA fc00::/7', () => {
    expect(isBlockedIPv6('fc00::1')).toBe(true);
    expect(isBlockedIPv6('fdaa:bbcc::1')).toBe(true);
  });

  it('blocks 6to4 encoding of private IPv4', () => {
    expect(isBlockedIPv6('2002:7f00:0001::')).toBe(true); // 127.0.0.1
    expect(isBlockedIPv6('2002:a9fe:a9fe::')).toBe(true); // 169.254.169.254
  });

  it('allows 6to4 encoding of public IPv4', () => {
    expect(isBlockedIPv6('2002:0808:0808::')).toBe(false); // 8.8.8.8
  });

  it('blocks documentation and Teredo/ORCHID ranges', () => {
    expect(isBlockedIPv6('2001:db8::1')).toBe(true);
    expect(isBlockedIPv6('2001::1')).toBe(true); // Teredo
    expect(isBlockedIPv6('2001:10::1')).toBe(true);
    expect(isBlockedIPv6('2001:20::1')).toBe(true);
  });

  it('blocks NAT64 well-known prefix (64:ff9b::/96) encoding private IPv4', () => {
    expect(isBlockedIPv6('64:ff9b::127.0.0.1')).toBe(true); // loopback
    expect(isBlockedIPv6('64:ff9b::10.0.0.1')).toBe(true); // RFC1918
    expect(isBlockedIPv6('64:ff9b::192.168.1.1')).toBe(true); // RFC1918
    expect(isBlockedIPv6('64:ff9b::169.254.169.254')).toBe(true); // link-local / metadata
    expect(isBlockedIPv6('64:ff9b::172.16.0.1')).toBe(true); // RFC1918
    expect(isBlockedIPv6('64:ff9b::0:7f00:1')).toBe(true); // 127.0.0.1 hex form
  });

  it('allows NAT64 well-known prefix encoding public IPv4', () => {
    expect(isBlockedIPv6('64:ff9b::8.8.8.8')).toBe(false);
    expect(isBlockedIPv6('64:ff9b::1.1.1.1')).toBe(false);
  });

  it('blocks NAT64 local-use prefix (64:ff9b:1::/48) encoding private IPv4', () => {
    expect(isBlockedIPv6('64:ff9b:1::7f00:1')).toBe(true); // 127.0.0.1
    expect(isBlockedIPv6('64:ff9b:1::a9fe:a9fe')).toBe(true); // 169.254.169.254
    expect(isBlockedIPv6('64:ff9b:1::a00:1')).toBe(true); // 10.0.0.1
    expect(isBlockedIPv6('64:ff9b:1:abcd:ef01:2345:c0a8:1')).toBe(true); // 192.168.0.1 with subnet bits
  });

  it('allows NAT64 local-use prefix encoding public IPv4', () => {
    expect(isBlockedIPv6('64:ff9b:1::808:808')).toBe(false); // 8.8.8.8
  });

  it('allows public addresses', () => {
    expect(isBlockedIPv6('2001:4860:4860::8888')).toBe(false); // Google DNS
    expect(isBlockedIPv6('2606:4700:4700::1111')).toBe(false); // Cloudflare
  });

  it('strips zone id before classification', () => {
    expect(isBlockedIPv6('fe80::1%eth0')).toBe(true);
  });

  it('returns false for non-IPv6 input', () => {
    expect(isBlockedIPv6('not-an-ip')).toBe(false);
    expect(isBlockedIPv6('127.0.0.1')).toBe(false); // IPv4, use isBlockedIPv4
  });
});

describe('parseBase64DataUrl', () => {
  it('parses a minimal data URL', () => {
    const out = parseBase64DataUrl('data:image/png;base64,iVBORw0KGgo=');
    expect(out?.mediaType).toBe('image/png');
    expect(out?.base64).toBe('iVBORw0KGgo=');
  });

  it('accepts MIME parameters before base64', () => {
    const out = parseBase64DataUrl('data:audio/wav;charset=binary;base64,UklGRg==');
    expect(out?.mediaType).toBe('audio/wav');
    expect(out?.base64).toBe('UklGRg==');
  });

  it('accepts multiple MIME parameters', () => {
    const out = parseBase64DataUrl('data:image/png;name=foo.png;charset=utf-8;base64,AA==');
    expect(out?.mediaType).toBe('image/png');
    expect(out?.base64).toBe('AA==');
  });

  it('accepts the bare data:;base64,... form', () => {
    const out = parseBase64DataUrl('data:;base64,AA==');
    expect(out?.mediaType).toBe('application/octet-stream');
    expect(out?.base64).toBe('AA==');
  });

  it('rejects non-data URLs', () => {
    expect(parseBase64DataUrl('http://example.com')).toBeNull();
  });

  it('rejects non-base64 data URLs', () => {
    expect(parseBase64DataUrl('data:text/plain,hello')).toBeNull();
  });

  it('rejects malformed data URLs without a comma', () => {
    expect(parseBase64DataUrl('data:image/png;base64')).toBeNull();
  });
});
