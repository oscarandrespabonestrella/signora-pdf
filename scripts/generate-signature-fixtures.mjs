// Regenerates projects/signora-pdf/validation/src/signed-fixtures.testing.ts: PDFs carrying REAL
// CMS signatures and RFC 3161 timestamps made by OpenSSL (an implementation independent from the
// validator under test). Needs `openssl` (3.4+) on the PATH.
// Run: node scripts/generate-signature-fixtures.mjs
// The output is committed; run it only when fixtures must change (keys are random each time).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { build } from 'esbuild';
import { buildSignatureFixture } from '../projects/signora-pdf/validation/src/signature-fixtures.testing.ts';

/** The library's own incremental-update and DSS code, bundled so the fixtures use the real thing. */
async function libraryTools() {
  // Inside node_modules so that `pdf-lib` resolves from the bundle.
  const outfile = join(process.cwd(), 'node_modules', '.cache', 'signora-fixture-tools.mjs');
  const pdfLib = 'projects/signora-pdf/pdf-lib/src';
  await build({
    stdin: {
      contents: `
        export { IncrementalUpdate } from './incremental-update';
        export { appendAnnotations } from './annotations';
        export { addToAcroForm } from './signature-fields-writer';
        export { appendDss } from './dss';
        export { appendVisualSignatures } from './incremental-writer';
      `,
      resolveDir: join(process.cwd(), pdfLib),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['pdf-lib'],
    alias: {
      'signora-pdf': join(process.cwd(), 'projects/signora-pdf/src/lib/coordinates/index.ts'),
    },
    outfile,
    logLevel: 'error',
  });
  return import(`file:///${outfile.replace(/\\/g, '/')}`);
}
const tools = await libraryTools();

const OUT = 'projects/signora-pdf/validation/src/signed-fixtures.testing.ts';
const RESERVED = 8192;
const SIGNATURE_TIMESTAMP_OID = '1.2.840.113549.1.9.16.2.14';
const dir = mkdtempSync(join(tmpdir(), 'signora-fixtures-'));
const f = (name) => join(dir, name);
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

function certificate(name, subject, { ca, signer, algorithm, tsa, ocsp, issuerName = 'ca' }) {
  if (algorithm === 'ec') {
    openssl(
      'genpkey',
      '-algorithm',
      'EC',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-out',
      f(`${name}.key`),
    );
  } else {
    openssl(
      'genpkey',
      '-algorithm',
      'RSA',
      '-pkeyopt',
      'rsa_keygen_bits:2048',
      '-out',
      f(`${name}.key`),
    );
  }
  openssl('req', '-new', '-key', f(`${name}.key`), '-subj', subject, '-out', f(`${name}.csr`));
  let ext;
  if (ca) {
    ext =
      'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n';
  } else if (ocsp) {
    ext =
      'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=OCSPSigning\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n';
  } else if (tsa) {
    ext =
      'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\n' +
      'subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n';
  } else {
    ext =
      'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,nonRepudiation\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n' +
      'authorityInfoAccess=OCSP;URI:http://ocsp.example.test/ocsp\ncrlDistributionPoints=URI:http://crl.example.test/root.crl\n';
  }
  writeFileSync(f(`${name}.ext`), ext);
  const issuer = signer
    ? ['-CA', f(`${issuerName}.pem`), '-CAkey', f(`${issuerName}.key`), '-CAcreateserial']
    : ['-signkey', f(`${name}.key`)];
  openssl(
    'x509',
    '-req',
    '-in',
    f(`${name}.csr`),
    ...issuer,
    '-extfile',
    f(`${name}.ext`),
    '-not_before',
    '20250101000000Z',
    '-not_after',
    '20350101000000Z',
    '-out',
    f(`${name}.pem`),
  );
}

certificate('ca', '/C=ES/O=Signora Test/CN=Signora Test Root CA', { ca: true });
certificate('rsa', '/C=ES/O=Signora Test/CN=Ada Lovelace/emailAddress=ada@example.test', {
  signer: true,
});
certificate('ec', '/C=ES/O=Signora Test/CN=Grace Hopper', { signer: true, algorithm: 'ec' });
certificate('tsaca', '/C=ES/O=Signora Test/CN=Signora Test TSA Root CA', { ca: true });
certificate('tsa', '/C=ES/O=Signora Test/CN=Signora Test TSA', {
  signer: true,
  tsa: true,
  issuerName: 'tsaca',
});
certificate('unrelated', '/C=ES/O=Elsewhere/CN=Unrelated Root CA', { ca: true });
certificate('int', '/C=ES/O=Signora Test/CN=Signora Test Intermediate CA', {
  ca: true,
  signer: true,
});
certificate('turing', '/C=ES/O=Signora Test/CN=Alan Turing', { signer: true, issuerName: 'int' });
certificate('mallory', '/C=ES/O=Signora Test/CN=Mallory Revoked', { signer: true });
certificate('ocspsigner', '/C=ES/O=Signora Test/CN=Signora Test OCSP Responder', {
  signer: true,
  ocsp: true,
});
writeFileSync(f('intchain.pem'), readFileSync(f('int.pem')) + readFileSync(f('ca.pem')));

// Timestamp authority configuration for `openssl ts`.
const slash = (p) => p.replace(/\\/g, '/');
writeFileSync(f('tsaserial'), '01\n');
writeFileSync(
  f('tsa.cnf'),
  [
    '[ tsa ]',
    'default_tsa = tsa_config',
    '[ tsa_config ]',
    `dir = ${slash(dir)}`,
    'serial = $dir/tsaserial',
    'crypto_device = builtin',
    'signer_cert = $dir/tsa.pem',
    'certs = $dir/tsaca.pem',
    'signer_key = $dir/tsa.key',
    'signer_digest = sha256',
    'default_policy = 1.2.3.4.1',
    'digests = sha256, sha384',
    'accuracy = secs:1',
    'ordering = no',
    'tsa_name = no',
    'ess_cert_id_chain = no',
    'ess_cert_id_alg = sha256',
    '',
  ].join('\n'),
);

// ---- Revocation evidence ------------------------------------------------------------------
const opensslText = (...args) =>
  openssl(...args)
    .toString('latin1')
    .trim();
const subjectOf = (name) =>
  opensslText('x509', '-in', f(`${name}.pem`), '-noout', '-subject', '-nameopt', 'compat').replace(
    /^subject=\s*/,
    '',
  );
const serialOf = (name) =>
  opensslText('x509', '-in', f(`${name}.pem`), '-noout', '-serial').replace(/^serial=/, '');
const indexTime = (date) => date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'; // YYMMDDHHMMSSZ

let batchCount = 0;
/**
 * A CRL and OCSP responses from the root CA, as of now. `revoked` lists `{ name, at, reason? }`;
 * `omit` leaves certificates out of the database, so OCSP says "unknown" for them.
 */
function revocationBatch({ revoked = [], omit = [], issuer = 'ca', names, crlDays = 3650 } = {}) {
  const id = `rev${batchCount++}`;
  const index = f(`${id}.idx`);
  const known = (names ?? ['rsa', 'ec', 'turing', 'mallory']).filter(
    (name) => !omit.includes(name),
  );
  writeFileSync(
    index,
    known
      .map((name) => {
        const r = revoked.find((entry) => entry.name === name);
        const expiry = '350101000000Z';
        const when = r ? `${indexTime(r.at)}${r.reason ? ',' + r.reason : ''}` : '';
        return `${r ? 'R' : 'V'}\t${expiry}\t${when}\t${serialOf(name)}\tunknown\t${subjectOf(name)}`;
      })
      .join('\n') + '\n',
  );
  writeFileSync(f(`${id}.num`), '01\n');
  writeFileSync(f(`${id}.attr`), 'unique_subject = no\n');
  copyFileSync(f(`${id}.attr`), `${index}.attr`);
  writeFileSync(
    f(`${id}.cnf`),
    [
      '[ ca ]',
      'default_ca = CA_default',
      '[ CA_default ]',
      `database = ${slash(index)}`,
      `crlnumber = ${slash(f(`${id}.num`))}`,
      `certificate = ${slash(f(`${issuer}.pem`))}`,
      `private_key = ${slash(f(`${issuer}.key`))}`,
      'default_md = sha256',
      `default_crl_days = ${crlDays}`,
      '',
    ].join('\n'),
  );
  openssl('ca', '-config', f(`${id}.cnf`), '-gencrl', '-out', f(`${id}.crl.pem`));
  openssl('crl', '-in', f(`${id}.crl.pem`), '-outform', 'DER', '-out', f(`${id}.crl`));
  const crl = readFileSync(f(`${id}.crl`));
  // Independent check: OpenSSL accepts the CRL it just made.
  openssl(
    'crl',
    '-in',
    f(`${id}.crl`),
    '-inform',
    'DER',
    '-noout',
    '-CAfile',
    f(`${issuer}.pem`),
    '-verify',
  );

  const ocsp = (name, responder = issuer) => {
    openssl(
      'ocsp',
      '-issuer',
      f(`${issuer}.pem`),
      '-cert',
      f(`${name}.pem`),
      '-reqout',
      f(`${id}.req`),
    );
    openssl(
      'ocsp',
      '-index',
      index,
      '-CA',
      f(`${issuer}.pem`),
      '-rsigner',
      f(`${responder}.pem`),
      '-rkey',
      f(`${responder}.key`),
      '-reqin',
      f(`${id}.req`),
      '-respout',
      f(`${id}-${name}.resp`),
      '-ndays',
      '3650',
    );
    return readFileSync(f(`${id}-${name}.resp`));
  };
  return { crl, ocsp };
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** RFC 3161 token (DER) over the given bytes, issued and checked by OpenSSL. */
function timestampToken(data) {
  writeFileSync(f('stamp.bin'), data);
  openssl(
    'ts',
    '-query',
    '-data',
    f('stamp.bin'),
    '-sha256',
    '-cert',
    '-no_nonce',
    '-out',
    f('req.tsq'),
  );
  openssl(
    'ts',
    '-reply',
    '-queryfile',
    f('req.tsq'),
    '-config',
    f('tsa.cnf'),
    '-token_out',
    '-out',
    f('token.der'),
  );
  openssl(
    'ts',
    '-verify',
    '-in',
    f('token.der'),
    '-token_in',
    '-data',
    f('stamp.bin'),
    '-CAfile',
    f('tsaca.pem'),
    '-no_check_time',
  );
  return readFileSync(f('token.der'));
}

let latestTokenTime = new Date(0);

/** Edits the CMS of a signature: `edit(signedData, signerInfo)`. Only unsigned parts may change. */
function editCms(cmsDer, edit) {
  const contentInfo = pkijs.ContentInfo.fromBER(cmsDer);
  const signedData = new pkijs.SignedData({ schema: contentInfo.content });
  edit(signedData, signedData.signerInfos[0]);
  contentInfo.content = signedData.toSchema(true);
  return Buffer.from(contentInfo.toSchema().toBER(false));
}

function addUnsignedAttribute(signerInfo, type, value) {
  const attribute = new pkijs.Attribute({ type, values: [value] });
  if (signerInfo.unsignedAttrs) signerInfo.unsignedAttrs.attributes.push(attribute);
  else
    signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: [attribute],
    });
}

const CADES_REVOCATION_VALUES_OID = '1.2.840.113549.1.9.16.2.24';

/** Puts a CRL in the CMS `crls` field and/or an OCSP response in a CAdES `revocation-values` attribute. */
function embedRevocation(cmsDer, { crl, ocspResponse }) {
  return editCms(cmsDer, (signedData, signerInfo) => {
    if (crl) signedData.crls = [pkijs.CertificateRevocationList.fromBER(crl)];
    if (ocspResponse) {
      const response = pkijs.OCSPResponse.fromBER(ocspResponse);
      const basic = new Uint8Array(response.responseBytes.response.valueBlock.valueHexView);
      const values = new asn1js.Sequence({
        value: [
          new asn1js.Constructed({
            idBlock: { tagClass: 3, tagNumber: 1 },
            value: [
              new asn1js.Sequence({
                value: [
                  asn1js.fromBER(
                    basic.buffer.slice(basic.byteOffset, basic.byteOffset + basic.length),
                  ).result,
                ],
              }),
            ],
          }),
        ],
      });
      addUnsignedAttribute(signerInfo, CADES_REVOCATION_VALUES_OID, values);
    }
  });
}

/** Adds an RFC 3161 token over the signature value as an unsigned attribute of the signer. */
function addSignatureTimestamp(cmsDer) {
  const contentInfo = pkijs.ContentInfo.fromBER(cmsDer);
  const signedData = new pkijs.SignedData({ schema: contentInfo.content });
  const signerInfo = signedData.signerInfos[0];
  const token = timestampToken(Buffer.from(signerInfo.signature.valueBlock.valueHexView));
  noteTokenTime(token);
  const parsed = asn1js.fromBER(new Uint8Array(token).buffer);
  signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 1,
    attributes: [new pkijs.Attribute({ type: SIGNATURE_TIMESTAMP_OID, values: [parsed.result] })],
  });
  contentInfo.content = signedData.toSchema(true);
  return Buffer.from(contentInfo.toSchema().toBER(false));
}

/** Remembers when the newest token was issued (for the "revoked after signing" evidence). */
function noteTokenTime(token) {
  const info = pkijs.ContentInfo.fromBER(new Uint8Array(token).buffer);
  const signed = new pkijs.SignedData({ schema: info.content });
  const tst = pkijs.TSTInfo.fromBER(
    new Uint8Array(signed.encapContentInfo.eContent.valueBlock.valueHexView),
  );
  if (tst.genTime > latestTokenTime) latestTokenTime = tst.genTime;
}

/** Signs (or timestamps) the bytes covered by one range and writes the result into its /Contents slot. */
function signInPlace(pdf, range, contentsRange, spec) {
  const [, l1, s2, l2] = range;
  const covered = Buffer.concat([
    Buffer.from(pdf.subarray(0, l1)),
    Buffer.from(pdf.subarray(s2, s2 + l2)),
  ]);
  let der;
  if (spec.docTimestamp) {
    der = timestampToken(covered);
    noteTokenTime(der);
  } else {
    writeFileSync(f('content.bin'), covered);
    const args = [
      'cms',
      '-sign',
      '-binary',
      '-in',
      f('content.bin'),
      '-signer',
      f(`${spec.signer}.pem`),
      '-inkey',
      f(`${spec.signer}.key`),
      '-certfile',
      f(spec.signer === 'turing' && !spec.noIntermediate ? 'intchain.pem' : 'ca.pem'),
      '-md',
      'sha256',
      '-outform',
      'DER',
      '-nosmimecap',
      '-out',
      f('sig.der'),
    ];
    if (spec.cades) args.push('-cades');
    openssl(...args);
    der = readFileSync(f('sig.der'));
    if (spec.timestamp) der = addSignatureTimestamp(der);
    if (spec.embed) der = embedRevocation(der, spec.embed);
    writeFileSync(f('sig.der'), der);
    // Independent check: OpenSSL itself must accept what we are about to embed.
    openssl(
      'cms',
      '-verify',
      '-binary',
      '-inform',
      'DER',
      '-in',
      f('sig.der'),
      '-content',
      f('content.bin'),
      '-CAfile',
      f('ca.pem'),
      ...(spec.noIntermediate ? ['-certfile', f('int.pem')] : []),
      '-purpose',
      'any',
      '-no_check_time',
      '-out',
      f('verified.bin'),
    );
  }
  const slot = contentsRange.end - contentsRange.start - 2;
  if (der.length * 2 > slot)
    throw new Error(`CMS (${der.length} bytes) does not fit in the reserved space`);
  pdf.set(Buffer.from(hex(der).padEnd(slot, '0'), 'latin1'), contentsRange.start + 1);
}

async function make(signatures, signing, extras) {
  const built = await buildSignatureFixture(signatures, [[595, 842]], RESERVED, extras);
  // A signature covering an earlier part of the file must be signed first.
  const order = built.byteRanges
    .map((range, i) => ({ range, i }))
    .sort((a, b) => a.range[2] + a.range[3] - (b.range[2] + b.range[3]));
  for (const { range, i } of order)
    signInPlace(built.pdf, range, built.contentsRanges[i], signing[i]);
  return built;
}

// Two entries: the first covers an earlier part of the file, the second covers everything.
const probe = await buildSignatureFixture([{ name: 'A' }, { name: 'B' }], [[595, 842]], RESERVED);
const firstEnd = probe.contentsRanges[1].start;

const early = revocationBatch();
const ocspEarlyDer = early.ocsp('rsa'); // issued now, before any timestamp
// Timestamps are issued with one-second resolution: make sure all of them come after this evidence.
await new Promise((resolve) => setTimeout(resolve, 2500)); // evidence to embed: issued before the timestamps, valid for "now"

const fixtures = {
  validRsa: await make(
    [
      {
        name: 'Signature1',
        reason: 'I approve this document',
        signerName: 'Ada Lovelace',
        rect: [50, 700, 250, 780],
      },
    ],
    [{ signer: 'rsa', cades: true }],
  ),
  validEc: await make(
    [{ name: 'Signature1', subFilter: 'adbe.pkcs7.detached', signerName: 'Grace Hopper' }],
    [{ signer: 'ec', cades: false }],
  ),
  twoSignatures: await make(
    [
      { name: 'First', signedUntil: firstEnd, signerName: 'Ada Lovelace' },
      { name: 'Second', signerName: 'Grace Hopper', rect: [300, 50, 500, 110] },
    ],
    [
      { signer: 'rsa', cades: true },
      { signer: 'ec', cades: true },
    ],
  ),
  claimedBeforeCertificate: await make(
    [{ name: 'Old', signingDate: 'D:20200101120000Z' }],
    [{ signer: 'rsa', cades: true }],
  ),
  signatureTimestamp: await make(
    [{ name: 'Signature1', signerName: 'Ada Lovelace' }],
    [{ signer: 'rsa', cades: true, timestamp: true }],
  ),
  documentTimestamp: await make(
    [
      { name: 'Signature1', signedUntil: firstEnd, signerName: 'Ada Lovelace' },
      { name: 'DocTimeStamp1', timestamp: true, rect: [0, 0, 0, 0] },
    ],
    [{ signer: 'rsa', cades: true }, { docTimestamp: true }],
  ),
  viaIntermediate: await make(
    [{ name: 'Signature1', signerName: 'Alan Turing' }],
    [{ signer: 'turing', cades: true }],
  ),
  turingNoIntermediate: await make(
    [{ name: 'Signature1', signerName: 'Alan Turing' }],
    [{ signer: 'turing', cades: true, noIntermediate: true }],
  ),
  revokedSigner: await make(
    [{ name: 'Signature1', signerName: 'Mallory' }],
    [{ signer: 'mallory', cades: true }],
  ),
  embeddedCrl: await make(
    [{ name: 'Signature1', signerName: 'Ada Lovelace' }],
    [{ signer: 'rsa', cades: true, embed: { crl: early.crl } }],
  ),
  embeddedOcsp: await make(
    [{ name: 'Signature1', signerName: 'Ada Lovelace' }],
    [{ signer: 'rsa', cades: true, embed: { ocspResponse: early.ocsp('rsa') } }],
  ),
};

// Evidence made after every timestamp, so it can vouch for the time they prove.
const day = 24 * 3600_000;
const longAgo = new Date('2026-01-01T00:00:00Z');
const clean = revocationBatch({ omit: ['ec'] });
const revoked = revocationBatch({
  revoked: [
    { name: 'rsa', at: longAgo, reason: 'superseded' },
    { name: 'mallory', at: longAgo, reason: 'keyCompromise' },
  ],
});
const revokedAfter = revocationBatch({
  revoked: [
    { name: 'rsa', at: new Date(latestTokenTime.getTime() + 1000), reason: 'keyCompromise' },
  ],
});
const revokedAfterBase = latestTokenTime;
const tsaClean = revocationBatch({ issuer: 'tsaca', names: ['tsa'] });
const tsaRevoked = revocationBatch({
  issuer: 'tsaca',
  names: ['tsa'],
  revoked: [{ name: 'tsa', at: longAgo, reason: 'keyCompromise' }],
});
const referenceTime = new Date(Date.now() + day);
const evidence = {
  crlClean: clean.crl,
  crlRevoked: revoked.crl,
  crlRevokedAfter: revokedAfter.crl,
  ocspGood: clean.ocsp('rsa'),
  ocspRevoked: revoked.ocsp('rsa'),
  ocspRevokedAfter: revokedAfter.ocsp('rsa'),
  ocspDelegatedGood: clean.ocsp('rsa', 'ocspsigner'),
  ocspUnknown: clean.ocsp('ec'),
  ocspMalloryRevoked: revoked.ocsp('mallory'),
  crlEarly: early.crl,
  ocspEarly: ocspEarlyDer,
  crlShortLived: revocationBatch({ crlDays: 1 }).crl,
  crlTsaClean: tsaClean.crl,
  crlTsaRevoked: tsaRevoked.crl,
};

// ---- Long-term validation: DSS and document timestamps added as incremental updates ------------
const der = (name) => {
  const text = readFileSync(f(`${name}.pem`), 'latin1').replace(/-----[A-Z ]+-----|\s+/g, '');
  return Buffer.from(text, 'base64');
};

/** The CMS container of the n-th signature of a fixture, without the zero padding. */
function signatureDer(built, n) {
  const { start, end } = built.contentsRanges[n];
  const bytes = Buffer.from(
    Buffer.from(built.pdf.subarray(start + 1, end - 1)).toString('latin1'),
    'hex',
  );
  let length = bytes[1];
  let header = 2;
  if (length >= 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[2 + i];
    header = 2 + (bytes[1] & 0x7f);
  }
  return bytes.subarray(0, header + length);
}

/**
 * Adds a signature field with a signature (or an RFC 3161 DocTimeStamp) covering the whole file, as
 * an incremental update. `spec` is what `signInPlace` takes: `{ docTimestamp: true }` or a signer.
 */
async function appendSigned(pdf, name, spec) {
  const update = await tools.IncrementalUpdate.load(pdf);
  const { lib, document, context } = update;
  const page = document.getPage(0);
  const placeholder = 9999999999;
  const stamp = !!spec.docTimestamp;
  const value = context.register(
    context.obj({
      Type: stamp ? 'DocTimeStamp' : 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: stamp ? 'ETSI.RFC3161' : 'ETSI.CAdES.detached',
      ByteRange: [placeholder, placeholder, placeholder, placeholder],
      Contents: lib.PDFHexString.of('0'.repeat(RESERVED * 2)),
      ...(stamp ? {} : { M: lib.PDFString.of('D:20260101120000Z'), Name: lib.PDFString.of(name) }),
    }),
  );
  const widget = context.register(
    context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: lib.PDFString.of(name),
      Rect: stamp ? [0, 0, 0, 0] : [300, 50, 500, 110],
      F: stamp ? 132 : 4,
      P: page.ref,
      V: value,
    }),
  );
  tools.appendAnnotations(update, page, [widget]);
  tools.addToAcroForm(update, [widget]);
  const bytes = Buffer.from(update.build());

  // Fill in the byte range, then sign, in the part that was just appended.
  const from = pdf.length;
  const start = bytes.indexOf('/Contents <', from, 'latin1') + '/Contents '.length; // offset of '<'
  const end = bytes.indexOf('>', start) + 1;
  const range = bytes.indexOf('/ByteRange [', from, 'latin1') + '/ByteRange ['.length;
  const close = bytes.indexOf(']', range);
  const numbers = [0, start, end, bytes.length - end]
    .map((n) => String(n).padStart(10, '0'))
    .join(' ');
  bytes.write(' ' + numbers + ' '.repeat(close - range - numbers.length - 1), range, 'latin1');
  signInPlace(bytes, [0, start, end, bytes.length - end], { start, end }, spec);
  return new Uint8Array(bytes);
}

const appendDocumentTimestamp = (pdf, name) => appendSigned(pdf, name, { docTimestamp: true });

const timestamped = fixtures.signatureTimestamp;
const adaSignature = signatureDer(timestamped, 0);
const dssEvidence = { crls: [evidence.crlClean, evidence.crlTsaClean] };
const dssCertificates = [der('ca'), der('tsaca'), der('tsa')];

const withDss = (pdf, extra = {}) =>
  tools.appendDss(pdf, {
    certs: dssCertificates,
    ...dssEvidence,
    signatures: [{ signature: adaSignature, certs: [der('ca')], crls: [evidence.crlClean] }],
    ...extra,
  });

const ltv = await withDss(timestamped.pdf);
fixtures.ltv = { pdf: ltv };
// The same, then a document timestamp over everything: the DSS is covered.
fixtures.archival = { pdf: await appendDocumentTimestamp(ltv, 'DocTimeStamp1') };
// The document timestamp first, the DSS after it: long-term, but not archival.
fixtures.dssAfterTimestamp = {
  pdf: await withDss(await appendDocumentTimestamp(timestamped.pdf, 'DocTimeStamp1')),
};
// Part of the DSS (the certificates) before the document timestamp, the evidence only after it:
// the timestamp does not cover what the signature relies on.
fixtures.dssSplitAroundTimestamp = {
  pdf: await tools.appendDss(
    await appendDocumentTimestamp(
      await tools.appendDss(timestamped.pdf, { certs: dssCertificates }),
      'DocTimeStamp1',
    ),
    { ...dssEvidence, signatures: [{ signature: adaSignature, crls: [evidence.crlClean] }] },
  ),
};
// ---- Changes after a signature: forms, locks, certification, real successive signatures ---------
const form = { formFields: [{ name: 'Name', value: 'Ada' }, { name: 'City' }] };
const adaPlain = (extra = {}) => [{ name: 'Signature1', signerName: 'Ada Lovelace', ...extra }];
fixtures.formSigned = await make(adaPlain(), [{ signer: 'rsa', cades: true }], form);
fixtures.lockedInclude = await make(
  adaPlain({ lock: { action: 'Include', fields: ['Name'] } }),
  [{ signer: 'rsa', cades: true }],
  form,
);
fixtures.lockedAll = await make(
  adaPlain({ lock: { action: 'All' } }),
  [{ signer: 'rsa', cades: true }],
  form,
);
for (const level of [1, 2, 3]) {
  fixtures[`certified${level}`] = await make(
    adaPlain({ docMdp: level }),
    [{ signer: 'rsa', cades: true }],
    form,
  );
}
// Two real, successive signatures: the second is an incremental update after the first.
fixtures.successive = {
  pdf: await appendSigned(fixtures.formSigned.pdf, 'Signature2', { signer: 'ec', cades: true }),
};
// A DSS whose CRL says the signer was revoked.
fixtures.dssRevoked = {
  pdf: await tools.appendDss(timestamped.pdf, {
    certs: dssCertificates,
    crls: [evidence.crlRevoked, evidence.crlTsaClean],
  }),
};
// The intermediate CA that the signature does not carry comes from the DSS.
fixtures.turingDss = {
  pdf: await tools.appendDss(fixtures.turingNoIntermediate.pdf, { certs: [der('int'), der('ca')] }),
};

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const lines = [
  '// GENERATED by scripts/generate-signature-fixtures.mjs. Do not edit.',
  '// PDFs with real CMS signatures and RFC 3161 timestamps made by OpenSSL, plus the test root CA.',
  '',
  'const decode = (base64: string): Uint8Array =>',
  '  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));',
  '',
  `export const TEST_ROOT_CA_PEM = ${JSON.stringify(readFileSync(f('ca.pem'), 'latin1'))};`,
  `export const TEST_TSA_ROOT_CA_PEM = ${JSON.stringify(readFileSync(f('tsaca.pem'), 'latin1'))};`,
  `export const UNRELATED_ROOT_CA_PEM = ${JSON.stringify(readFileSync(f('unrelated.pem'), 'latin1'))};`,
  '/** A moment after all the evidence below was issued and before it expires: use it as `validationTime`. */',
  `export const REFERENCE_TIME = new Date(${JSON.stringify(referenceTime.toISOString())});`,
  `/** When the newest timestamp in the fixtures was issued. */`,
  `export const LATEST_TIMESTAMP_TIME = new Date(${JSON.stringify(revokedAfterBase.toISOString())});`,
  '',
];
for (const [name, built] of Object.entries(fixtures)) {
  lines.push(`const ${name}Base64 =\n  '${b64(built.pdf)}';`, '');
}
lines.push(
  '/** Valid signature, RSA + SHA-256, PAdES (CAdES) with signing-certificate-v2. */',
  'export const validRsaPdf = (): Uint8Array => decode(validRsaBase64);',
  '/** Valid signature, ECDSA P-256 + SHA-256, `adbe.pkcs7.detached`. */',
  'export const validEcPdf = (): Uint8Array => decode(validEcBase64);',
  '/** Two valid signatures; the first covers only an earlier part of the file. */',
  'export const twoSignaturesPdf = (): Uint8Array => decode(twoSignaturesBase64);',
  '/** Valid signature whose claimed time (2020) precedes the certificate validity (2025). */',
  'export const claimedBeforeCertificatePdf = (): Uint8Array =>',
  '  decode(claimedBeforeCertificateBase64);',
  '/** PAdES signature carrying an RFC 3161 timestamp over its signature value (B-T). */',
  'export const signatureTimestampPdf = (): Uint8Array => decode(signatureTimestampBase64);',
  '/** A signature followed by an RFC 3161 document timestamp covering the whole file. */',
  'export const documentTimestampPdf = (): Uint8Array => decode(documentTimestampBase64);',
  '/** Signed by Alan Turing, whose certificate was issued by an intermediate CA embedded in the signature. */',
  'export const viaIntermediatePdf = (): Uint8Array => decode(viaIntermediateBase64);',
  '/** Signed by a certificate that the root CA revoked (see `crlRevoked`). */',
  'export const revokedSignerPdf = (): Uint8Array => decode(revokedSignerBase64);',
  '/** Valid signature carrying a clean CRL in the CMS `crls` field. */',
  'export const embeddedCrlPdf = (): Uint8Array => decode(embeddedCrlBase64);',
  '/** Valid signature carrying an OCSP "good" response in a CAdES `revocation-values` attribute. */',
  'export const embeddedOcspPdf = (): Uint8Array => decode(embeddedOcspBase64);',
  '/** Signed by Alan Turing; the CMS has no intermediate CA certificate. */',
  'export const turingNoIntermediatePdf = (): Uint8Array => decode(turingNoIntermediateBase64);',
  '/** The same, with the intermediate CA in a DSS added afterwards. */',
  'export const turingDssPdf = (): Uint8Array => decode(turingDssBase64);',
  '/** PAdES-B-T plus a DSS (certificates, CRLs and a /VRI entry) added after the signature: B-LT. */',
  'export const ltvPdf = (): Uint8Array => decode(ltvBase64);',
  '/** The same, followed by a document timestamp that covers the DSS: B-LTA. */',
  'export const archivalPdf = (): Uint8Array => decode(archivalBase64);',
  '/** A document timestamp first and the DSS after it: B-LT, not B-LTA. */',
  'export const dssAfterTimestampPdf = (): Uint8Array => decode(dssAfterTimestampBase64);',
  '/** Ada signed a form with two text fields, Name (filled) and City (empty). */',
  'export const formSignedPdf = (): Uint8Array => decode(formSignedBase64);',
  '/** The same, the signature locking the field Name (FieldMDP Include). */',
  'export const lockedIncludePdf = (): Uint8Array => decode(lockedIncludeBase64);',
  '/** The same, the signature locking every field (FieldMDP All). */',
  'export const lockedAllPdf = (): Uint8Array => decode(lockedAllBase64);',
  '/** The same form, certified with DocMDP level 1 (no changes). */',
  'export const certified1Pdf = (): Uint8Array => decode(certified1Base64);',
  '/** Certified with DocMDP level 2 (forms and signing). */',
  'export const certified2Pdf = (): Uint8Array => decode(certified2Base64);',
  '/** Certified with DocMDP level 3 (also annotations). */',
  'export const certified3Pdf = (): Uint8Array => decode(certified3Base64);',
  '/** The form signed by Ada and, as a real incremental update after it, by Grace. */',
  'export const successivePdf = (): Uint8Array => decode(successiveBase64);',
  '/** The certificates in the DSS before a document timestamp, the CRLs only after it: B-LT. */',
  'export const dssSplitAroundTimestampPdf = (): Uint8Array => decode(dssSplitAroundTimestampBase64);',
  '/** A DSS whose CRL lists the signer as revoked. */',
  'export const dssRevokedPdf = (): Uint8Array => decode(dssRevokedBase64);',
);
for (const [name, bytes] of Object.entries(evidence)) {
  lines.push(
    `const ${name}Base64 =\n  '${b64(bytes)}';`,
    `/** DER ${name.startsWith('crl') ? 'CRL' : 'OCSP response'} from the root CA (see the generator for what it says). */`,
    `export const ${name} = (): Uint8Array => decode(${name}Base64);`,
  );
}
writeFileSync(OUT, lines.join('\n') + '\n');
// Samples used by the playground example (one valid, one with a changed byte).
writeFileSync('projects/playground/public/samples/signed.pdf', fixtures.signatureTimestamp.pdf);
const tampered = fixtures.signatureTimestamp.pdf.slice();
tampered[10] ^= 0xff;
writeFileSync('projects/playground/public/samples/signed-tampered.pdf', tampered);
// A certified (DocMDP level 2) form with an annotation added afterwards, which level 2 forbids.
const redPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8Dwn4EIAAA/AQMBXY4aLQAAAABJRU5ErkJggg==';
const editedAfterCertifying = await tools.appendVisualSignatures(
  fixtures.certified2.pdf,
  [
    {
      id: 'late',
      asset: { id: 'red', kind: 'image', dataUrl: redPng, aspectRatio: 1 },
      pageIndex: 0,
      rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
    },
  ],
  { ignoreDocMdp: true },
);
writeFileSync('projects/playground/public/samples/signed-edited.pdf', editedAfterCertifying);
// A long-term sample for the playground.
writeFileSync('projects/playground/public/samples/signed-ltv.pdf', fixtures.archival.pdf);
// Sample CRLs from the root test CA: one that lists nobody, one that revokes the signer of signed.pdf.
writeFileSync('projects/playground/public/samples/test-crl.der', evidence.crlClean);
writeFileSync('projects/playground/public/samples/test-crl-revoked.der', evidence.crlRevoked);
// The two test CAs, so the playground can show a trusted result.
writeFileSync(
  'projects/playground/public/samples/test-trust-anchors.pem',
  readFileSync(f('ca.pem'), 'latin1') + readFileSync(f('tsaca.pem'), 'latin1'),
);
rmSync(dir, { recursive: true, force: true });
console.log('Wrote', OUT);
