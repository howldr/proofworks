/**
 * Unit tests for the email deep-link builder. This is the code that broke in
 * production (links pointed at the appliance host with a double slash), so it
 * gets direct coverage independent of the LiquidFiles client.
 */

const { appBaseUrl, policyUrl } = require('../src/liquidfiles/messages');

describe('email app links', () => {
  const original = process.env.APP_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = original;
  });

  test('falls back to the app host when APP_BASE_URL is unset', () => {
    delete process.env.APP_BASE_URL;
    expect(appBaseUrl()).toBe('https://proofworks.howldr.com');
    expect(policyUrl('POL-2026-001')).toBe(
      'https://proofworks.howldr.com/policies/view?id=POL-2026-001'
    );
  });

  test('strips trailing slashes so links never get a double //', () => {
    process.env.APP_BASE_URL = 'https://proofworks.howldr.com//';
    expect(policyUrl('POL-2026-001')).toBe(
      'https://proofworks.howldr.com/policies/view?id=POL-2026-001'
    );
  });

  test('uses the configured host and the static-export route shape', () => {
    process.env.APP_BASE_URL = 'https://app.example.com';
    // The route is /policies/view?id=… — NOT /policies/:id (which 404s).
    expect(policyUrl('POL-2026-001')).toBe(
      'https://app.example.com/policies/view?id=POL-2026-001'
    );
  });

  test('encodes the policy id', () => {
    process.env.APP_BASE_URL = 'https://app.example.com';
    expect(policyUrl('POL 2026/001')).toBe(
      'https://app.example.com/policies/view?id=POL%202026%2F001'
    );
  });
});
