import { describe, expect, it } from 'vitest';
import { SignInChallengeError, classifyPage, isWaveSignInUrl, type PageSnapshot } from './auth0-sign-in.js';

const BUSINESS_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://auth.waveapps.com/u/login/identifier?state=x',
    title: 'Log in | Wave',
    hasWaveCookie: false,
    usernameVisible: false,
    passwordVisible: false,
    otpVisible: false,
    challengeVisible: false,
    errorText: null,
    ...over,
  };
}

describe('classifyPage', () => {
  it('reads the Auth0 email page as the identifier step', () => {
    expect(classifyPage(snap({ usernameVisible: true }))).toBe('identifier');
  });

  it('prefers the password step when a password field is showing', () => {
    expect(classifyPage(snap({ url: 'https://auth.waveapps.com/u/login/password', passwordVisible: true }))).toBe('password');
  });

  it("reads Wave's /auth/verify code boxes as the OTP step", () => {
    expect(classifyPage(snap({ url: 'https://next.waveapps.com/auth/verify', otpVisible: true }))).toBe('otp');
  });

  it('is signed in only with a real cookie on a business URL', () => {
    const dashboard = `https://next.waveapps.com/${BUSINESS_UUID}/dashboard`;
    expect(classifyPage(snap({ url: dashboard, hasWaveCookie: true }))).toBe('signed-in');
    expect(classifyPage(snap({ url: dashboard, hasWaveCookie: false }))).toBe('waiting');
    expect(classifyPage(snap({ url: 'https://next.waveapps.com/auth/verify', hasWaveCookie: true }))).toBe('waiting');
  });

  it("spots Cloudflare's block page before anything else", () => {
    expect(classifyPage(snap({ title: 'Wave Maintenance', usernameVisible: true }))).toBe('blocked');
  });

  it('stops for a visible CAPTCHA even when a form field is showing', () => {
    expect(classifyPage(snap({ challengeVisible: true, passwordVisible: true }))).toBe('challenge');
  });

  it('reports a visible error message', () => {
    expect(classifyPage(snap({ errorText: 'Wrong email or password', passwordVisible: true }))).toBe('error');
  });

  it('waits while redirects are in flight', () => {
    expect(classifyPage(snap({ url: 'https://next.waveapps.com/auth/auth0', title: '' }))).toBe('waiting');
  });

  it('refuses a sign-in form on any host but Wave', () => {
    for (const url of [
      'https://evil.example/u/login/password',
      'https://waveapps.com.evil.example/login',
      'https://evilwaveapps.com/login',
      'http://auth.waveapps.com/u/login/password',
      'not a url',
    ]) {
      expect(classifyPage(snap({ url, usernameVisible: true }))).toBe('foreign-host');
      expect(classifyPage(snap({ url, passwordVisible: true }))).toBe('foreign-host');
      expect(classifyPage(snap({ url, otpVisible: true }))).toBe('foreign-host');
    }
  });

  it('lets a foreign page with no form through as waiting, mid-redirect', () => {
    expect(classifyPage(snap({ url: 'https://cdn.example/redirect' }))).toBe('waiting');
  });
});

describe('isWaveSignInUrl', () => {
  it('accepts https on waveapps.com and its subdomains', () => {
    expect(isWaveSignInUrl('https://auth.waveapps.com/u/login/identifier?state=x')).toBe(true);
    expect(isWaveSignInUrl('https://my.waveapps.com/login/')).toBe(true);
    expect(isWaveSignInUrl('https://next.waveapps.com/auth/verify')).toBe(true);
    expect(isWaveSignInUrl('https://AUTH.WAVEAPPS.COM/u/login')).toBe(true);
    expect(isWaveSignInUrl('https://waveapps.com/')).toBe(true);
  });

  it('rejects other hosts, lookalikes, plain http and junk', () => {
    expect(isWaveSignInUrl('https://waveapps.com.evil.example/')).toBe(false);
    expect(isWaveSignInUrl('https://evilwaveapps.com/')).toBe(false);
    expect(isWaveSignInUrl('https://auth.waveapps.com@evil.example/')).toBe(false);
    expect(isWaveSignInUrl('http://auth.waveapps.com/')).toBe(false);
    expect(isWaveSignInUrl('about:blank')).toBe(false);
    expect(isWaveSignInUrl('')).toBe(false);
  });
});

describe('SignInChallengeError', () => {
  it('tells the user how to sign in by hand', () => {
    const err = new SignInChallengeError('Wave showed a CAPTCHA challenge');
    expect(err.message).toMatch(/CAPTCHA/);
    expect(err.message).toMatch(/npx waveapps-mcp login/);
  });
});
