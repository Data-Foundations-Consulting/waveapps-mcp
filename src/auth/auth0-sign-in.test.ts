import { describe, expect, it } from 'vitest';
import {
  SignInChallengeError,
  classifyPage,
  fillOnWave,
  isWaveSignInUrl,
  type PageSnapshot,
  type SecretField,
  type SecretFieldSource,
} from './auth0-sign-in.js';

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
      'https://auth.waveapps.com:8443/u/login/password',
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
    expect(isWaveSignInUrl('https://auth.waveapps.com:443/u/login')).toBe(true);
  });

  it('rejects other hosts, lookalikes, plain http and junk', () => {
    expect(isWaveSignInUrl('https://waveapps.com.evil.example/')).toBe(false);
    expect(isWaveSignInUrl('https://evilwaveapps.com/')).toBe(false);
    expect(isWaveSignInUrl('https://auth.waveapps.com@evil.example/')).toBe(false);
    expect(isWaveSignInUrl('http://auth.waveapps.com/')).toBe(false);
    expect(isWaveSignInUrl('https://auth.waveapps.com:8443/')).toBe(false);
    expect(isWaveSignInUrl('https://auth.waveapps.com./')).toBe(false);
    expect(isWaveSignInUrl('about:blank')).toBe(false);
    expect(isWaveSignInUrl('')).toBe(false);
  });
});

describe('fillOnWave', () => {
  /** A field whose document is at `href`, recording what was typed into it. */
  function fakeField(href: string): SecretField & { typed: string[]; disposed: boolean } {
    const field = {
      typed: [] as string[],
      disposed: false,
      evaluate: async <R>(): Promise<R> => href as unknown as R,
      fill: async (value: string): Promise<void> => {
        field.typed.push(value);
      },
      click: async (): Promise<void> => undefined,
      dispose: async (): Promise<void> => {
        field.disposed = true;
      },
    };
    return field;
  }
  const pageWith = (field: SecretField | null): SecretFieldSource => ({ waitForSelector: async () => field });

  it("types into a field whose document is on Wave", async () => {
    const field = fakeField('https://auth.waveapps.com/u/login/password');
    await fillOnWave(pageWith(field), 'input[name="password"]', 'FAKE_PASSWORD');
    expect(field.typed).toEqual(['FAKE_PASSWORD']);
    expect(field.disposed).toBe(true);
  });

  it('refuses a field whose document left Wave, even if the page looked fine at snapshot time', async () => {
    const field = fakeField('https://evil.example/u/login/password');
    await expect(fillOnWave(pageWith(field), 'input[name="password"]', 'FAKE_PASSWORD')).rejects.toThrow(SignInChallengeError);
    expect(field.typed).toEqual([]);
    expect(field.disposed).toBe(true);
  });

  it('names the foreign host and points at a manual sign-in', async () => {
    const err = await fillOnWave(pageWith(fakeField('https://evil.example/x')), 'input', 'FAKE_PASSWORD').catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/evil\.example, not Wave/);
    expect((err as Error).message).toMatch(/login/);
  });

  it('stops when the field is gone', async () => {
    await expect(fillOnWave(pageWith(null), 'input', 'FAKE_PASSWORD')).rejects.toThrow(/disappeared/);
  });
});

describe('SignInChallengeError', () => {
  it('tells the user how to sign in by hand', () => {
    const err = new SignInChallengeError('Wave showed a CAPTCHA challenge');
    expect(err.message).toMatch(/CAPTCHA/);
    expect(err.message).toMatch(/npx waveapps-mcp login/);
  });
});
