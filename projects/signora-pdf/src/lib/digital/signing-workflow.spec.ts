import { TestBed } from '@angular/core/testing';
import type { PageInfo } from '../models';
import type {
  CertificateProvider,
  DigitalSignRequest,
  DigitalSignResult,
  DigitalSignatureProvider,
  PdfDocumentHandle,
  PdfRenderingPort,
  PdfWriterPort,
} from '../ports';
import {
  provideSignora,
  type SignoraFeature,
  withCertificateProvider,
  withDigitalSigner,
  withRenderer,
  withWriter,
} from '../providers';
import { SigningSession } from '../session';
import { DigitalSigningError } from './errors';
import { SigningWorkflow } from './signing-workflow';

const text = (value: string) => new TextEncoder().encode(value);
const ORIGINAL = text('%PDF-1.7 original');
const VISUAL = text('%PDF-1.7 with visual signatures');
const SIGNED = text('%PDF-1.7 << /Type /Sig /ByteRange [0 1 2 3] >>');

class Handle implements PdfDocumentHandle {
  readonly pageCount = 1;
  getPageInfo(): Promise<PageInfo> {
    return Promise.reject(new Error('not needed'));
  }
  renderPage(): never {
    throw new Error('not needed');
  }
  getData() {
    return Promise.resolve(ORIGINAL);
  }
  destroy() {
    return Promise.resolve();
  }
}

class Renderer implements PdfRenderingPort {
  load() {
    return Promise.resolve(new Handle());
  }
}

class Writer implements PdfWriterPort {
  static received: Uint8Array | null = null;
  applyVisualSignatures(pdf: Uint8Array) {
    Writer.received = pdf;
    return Promise.resolve(VISUAL);
  }
}

function signer(
  result: Partial<DigitalSignResult> | (() => Promise<DigitalSignResult>),
  seen: DigitalSignRequest[] = [],
): DigitalSignatureProvider {
  return {
    id: 'fake',
    sign: (request) => {
      seen.push(request);
      if (typeof result === 'function') return result();
      return Promise.resolve({
        pdf: SIGNED,
        cryptographic: true,
        providerId: 'fake',
        signedAt: new Date(),
        ...result,
      });
    },
  };
}

async function setup(...extra: SignoraFeature[]) {
  TestBed.configureTestingModule({
    providers: [provideSignora(withRenderer(Renderer), withWriter(Writer), ...extra)],
  });
  await TestBed.inject(SigningSession).load('x.pdf');
  return TestBed.inject(SigningWorkflow);
}

describe('SigningWorkflow', () => {
  beforeEach(() => (Writer.received = null));

  it('fails clearly when no signer is registered', async () => {
    const workflow = await setup();
    await expect(workflow.sign()).rejects.toThrow(/withDigitalSigner/);
  });

  it('signs the bytes produced by the visual export, after the visual stage', async () => {
    const seen: DigitalSignRequest[] = [];
    class Registered {
      readonly id = 'fake';
      sign = signer({}, seen).sign;
    }
    const workflow = await setup(withDigitalSigner(Registered));
    const result = await workflow.sign({ reason: 'Approval', level: 'B-T' });

    expect(Writer.received).toEqual(ORIGINAL);
    expect(seen[0].pdf).toEqual(VISUAL);
    expect(seen[0].reason).toBe('Approval');
    expect(seen[0].level).toBe('B-T');
    expect(result.cryptographic).toBe(true);
  });

  it('uses an explicit provider over the registered one', async () => {
    const registered = vi.fn();
    class Registered {
      readonly id = 'registered';
      sign = registered;
    }
    const seen: DigitalSignRequest[] = [];
    const workflow = await setup(withDigitalSigner(Registered));
    await workflow.sign({ provider: signer({}, seen) });
    expect(registered).not.toHaveBeenCalled();
    expect(seen.length).toBe(1);
  });

  it('rejects a result that is not a PDF', async () => {
    const workflow = await setup();
    await expect(workflow.sign({ provider: signer({ pdf: text('nope') }) })).rejects.toThrow(
      DigitalSigningError,
    );
  });

  it('rejects a provider that claims a cryptographic signature but returns none', async () => {
    const workflow = await setup();
    await expect(
      workflow.sign({ provider: signer({ pdf: VISUAL, cryptographic: true }) }),
    ).rejects.toThrow(/contains none/);
  });

  it('accepts an honest non-cryptographic (simulated) result without a signature', async () => {
    const workflow = await setup();
    const result = await workflow.sign({ provider: signer({ pdf: VISUAL, cryptographic: false }) });
    expect(result.cryptographic).toBe(false);
  });

  it('reports busy while signing and recovers after a failure', async () => {
    const workflow = await setup();
    let release!: (r: DigitalSignResult) => void;
    const pending = workflow.sign({
      provider: signer(() => new Promise((resolve) => (release = resolve))),
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(workflow.busy()).toBe(true);
    release({ pdf: SIGNED, cryptographic: true, providerId: 'fake', signedAt: new Date() });
    await pending;
    expect(workflow.busy()).toBe(false);

    await expect(
      workflow.sign({ provider: signer(() => Promise.reject(new Error('boom'))) }),
    ).rejects.toThrow('boom');
    expect(workflow.busy()).toBe(false);
  });

  describe('certificates', () => {
    it('is empty without a certificate provider', async () => {
      expect(await (await setup()).listCertificates()).toEqual([]);
    });

    it('lists certificates from the registered provider', async () => {
      class Certificates implements CertificateProvider {
        readonly id = 'certs';
        listCertificates() {
          return Promise.resolve([{ id: 'c1', subject: 'CN=Ada' }]);
        }
      }
      const workflow = await setup(withCertificateProvider(Certificates));
      expect(await workflow.listCertificates()).toEqual([{ id: 'c1', subject: 'CN=Ada' }]);
    });
  });
});
