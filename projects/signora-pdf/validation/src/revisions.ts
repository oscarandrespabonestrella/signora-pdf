import type { LaterChange, LaterChangeKind, LaterRevisions } from 'signora-pdf';
import { collectFormFields, readDocMdpPermission, type FormFieldRecord } from 'signora-pdf/pdf-lib';
import type { PDFArray, PDFDict, PDFDocument, PDFObject } from 'pdf-lib';
import { sameBytes } from './bytes';

type Lib = typeof import('pdf-lib');

/** Changes DocMDP allows at each level (ISO 32000-2, 12.8.2.2). Metadata updates always travel with a save. */
const DOC_MDP_ALLOWED: Readonly<Record<1 | 2 | 3, ReadonlySet<LaterChangeKind>>> = {
  1: new Set(['validation-data', 'document-timestamp', 'metadata']),
  2: new Set(['validation-data', 'document-timestamp', 'metadata', 'signature', 'form-fill']),
  3: new Set([
    'validation-data',
    'document-timestamp',
    'metadata',
    'signature',
    'form-fill',
    'annotation',
    // Annotations include the widgets of new fields.
    'signature-field',
    'form-field',
  ]),
};

type RoleType =
  | 'catalog'
  | 'pages-node'
  | 'page'
  | 'annots'
  | 'annotation'
  | 'acroform'
  | 'fields'
  | 'dss'
  | 'metadata';

interface Role {
  readonly type: RoleType;
  /** For annotations that are the widget of a form field. */
  readonly field?: { readonly name: string; readonly type?: string };
}

/** A revision of the document, parsed, with what each of its objects is for. */
interface Snapshot {
  readonly document: PDFDocument;
  readonly objects: ReadonlyMap<number, PDFObject>;
  readonly roles: ReadonlyMap<number, Role>;
  readonly fields: readonly FormFieldRecord[];
  readonly pageCount: number;
}

const MAX_DEPTH = 32;

const bytesOf = (object: PDFObject): Uint8Array => {
  const bytes = new Uint8Array(object.sizeInBytes());
  object.copyBytesInto(bytes, 0);
  return bytes;
};

function snapshot(lib: Lib, document: PDFDocument): Snapshot {
  const { PDFName, PDFDict, PDFArray, PDFRef } = lib;
  const objects = new Map<number, PDFObject>();
  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    objects.set(ref.objectNumber, object);
  }

  const roles = new Map<number, Role>();
  const mark = (value: PDFObject | undefined, role: Role) => {
    if (value instanceof PDFRef) roles.set(value.objectNumber, role);
  };

  const root = document.context.trailerInfo.Root;
  mark(root, { type: 'catalog' });
  const catalog = document.catalog;

  // Page tree.
  const walkPages = (node: PDFDict, depth: number) => {
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    for (let i = 0; kids && depth < MAX_DEPTH && i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (!kid) continue;
      if (kid.has(PDFName.of('Kids'))) {
        mark(kids.get(i), { type: 'pages-node' });
        walkPages(kid, depth + 1);
      }
    }
  };
  const pagesRoot = catalog.lookupMaybe(PDFName.of('Pages'), PDFDict);
  mark(catalog.get(PDFName.of('Pages')), { type: 'pages-node' });
  if (pagesRoot) walkPages(pagesRoot, 0);

  const pages = document.getPages();
  for (const page of pages) {
    roles.set(page.ref.objectNumber, { type: 'page' });
    const annots = page.node.get(PDFName.of('Annots'));
    mark(annots, { type: 'annots' });
    const array = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let i = 0; array && i < array.size(); i++) mark(array.get(i), { type: 'annotation' });
  }

  // The form: its dictionary, the /Fields array and every field (a widget keeps its field's name).
  const acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  mark(catalog.get(PDFName.of('AcroForm')), { type: 'acroform' });
  mark(acroForm?.get(PDFName.of('Fields')), { type: 'fields' });
  let fields: FormFieldRecord[] = [];
  try {
    fields = collectFormFields(lib, document);
  } catch {
    // an unreadable form: its fields simply have no role
  }
  for (const record of fields) {
    const info = { name: record.name, type: record.type };
    mark(record.ref, { type: 'annotation', field: info });
    for (let i = 0; record.kids && i < record.kids.size(); i++) {
      mark(record.kids.get(i), { type: 'annotation', field: info });
    }
  }

  // The DSS: its dictionary, lists and streams.
  const dssEntry = catalog.get(PDFName.of('DSS'));
  mark(dssEntry, { type: 'dss' });
  const dss = catalog.lookupMaybe(PDFName.of('DSS'), PDFDict);
  const markDss = (holder: PDFDict | undefined, depth: number) => {
    for (const [, value] of holder?.entries() ?? []) {
      mark(value, { type: 'dss' });
      const resolved = holder!.context.lookup(value);
      if (resolved instanceof PDFArray) {
        for (let i = 0; i < resolved.size(); i++) mark(resolved.get(i), { type: 'dss' });
      } else if (resolved instanceof PDFDict && depth < 3) markDss(resolved, depth + 1);
    }
  };
  markDss(dss, 0);

  mark(catalog.get(PDFName.of('Metadata')), { type: 'metadata' });
  mark(document.context.trailerInfo.Info, { type: 'metadata' });

  return { document, objects, roles, fields, pageCount: pages.length };
}

/** Keys whose value differs between two dictionaries (a key on one side only counts). */
function changedKeys(lib: Lib, before: PDFDict, after: PDFDict): Set<string> {
  const keys = new Set<string>();
  const names = new Set([...before.keys(), ...after.keys()].map((name) => name.decodeText()));
  for (const name of names) {
    const key = lib.PDFName.of(name);
    const a = before.get(key);
    const b = after.get(key);
    if (!a || !b || !sameBytes(bytesOf(a), bytesOf(b))) keys.add(name);
  }
  return keys;
}

/** How many references of `before` are no longer in `after`. */
function removedRefs(lib: Lib, before: PDFArray | undefined, after: PDFArray | undefined): number {
  const kept = new Set<number>();
  for (let i = 0; after && i < after.size(); i++) {
    const ref = after.get(i);
    if (ref instanceof lib.PDFRef) kept.add(ref.objectNumber);
  }
  let removed = 0;
  for (let i = 0; before && i < before.size(); i++) {
    const ref = before.get(i);
    if (ref instanceof lib.PDFRef && !kept.has(ref.objectNumber)) removed++;
  }
  return removed;
}

interface Record_ {
  readonly kind: LaterChangeKind;
  readonly field?: string;
  /** The field already existed in the signed revision. */
  readonly existed: boolean;
}

/** What a signature field's value dictionary says it is. */
function signatureKind(lib: Lib, value: PDFDict | undefined): LaterChangeKind {
  const { PDFName } = lib;
  const type = value?.lookup(PDFName.of('Type'));
  const subFilter = value?.lookup(PDFName.of('SubFilter'));
  const isStamp =
    (type instanceof PDFName && type.decodeText() === 'DocTimeStamp') ||
    (subFilter instanceof PDFName && subFilter.decodeText() === 'ETSI.RFC3161');
  return isStamp ? 'document-timestamp' : 'signature';
}

/** The fields a FieldMDP lock covers, as a test on a field name. */
interface Lock {
  readonly covers: (name: string) => boolean;
}

function readLock(lib: Lib, before: Snapshot, fieldName: string): Lock | undefined {
  const { PDFName, PDFDict, PDFArray, PDFHexString, PDFString } = lib;
  const record = before.fields.find((f) => f.name === fieldName);
  if (!record) return undefined;

  const text = (value: PDFObject | undefined) =>
    value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : undefined;
  const parse = (holder: PDFDict | undefined): Lock | undefined => {
    if (!holder) return undefined;
    const action = holder.lookup(PDFName.of('Action'));
    if (!(action instanceof PDFName)) return undefined;
    const names = new Set<string>();
    const list = holder.lookupMaybe(PDFName.of('Fields'), PDFArray);
    for (let i = 0; list && i < list.size(); i++) {
      const name = text(list.lookup(i));
      if (name) names.add(name);
    }
    switch (action.decodeText()) {
      case 'All':
        return { covers: () => true };
      case 'Include':
        return { covers: (name) => names.has(name) };
      case 'Exclude':
        return { covers: (name) => !names.has(name) };
      default:
        return undefined;
    }
  };

  // SigFieldLock in the field, or a FieldMDP transform in the signature's references.
  const lock = parse(record.field.lookupMaybe(PDFName.of('Lock'), PDFDict));
  if (lock) return lock;
  const value = record.field.lookupMaybe(PDFName.of('V'), PDFDict);
  const references = value?.lookupMaybe(PDFName.of('Reference'), PDFArray);
  for (let i = 0; references && i < references.size(); i++) {
    const reference = references.lookupMaybe(i, PDFDict);
    const method = reference?.lookup(PDFName.of('TransformMethod'));
    if (method instanceof PDFName && method.decodeText() === 'FieldMDP') {
      return parse(reference?.lookupMaybe(PDFName.of('TransformParams'), PDFDict));
    }
  }
  return undefined;
}

/** Compares the signed revision with the final file and lists what changed, by kind. */
function classify(lib: Lib, before: Snapshot, after: Snapshot): Record_[] {
  const { PDFName, PDFDict, PDFArray, PDFRef } = lib;
  const found: Record_[] = [];
  const add = (kind: LaterChangeKind, field?: string, existed = true) =>
    found.push({ kind, field, existed });

  const isStructural = (object: PDFObject) => {
    if (!(object instanceof PDFDict) && !('dict' in object)) return false;
    const dict =
      object instanceof PDFDict ? object : ((object as { dict: PDFDict }).dict as PDFDict);
    const type = dict.lookup(PDFName.of('Type'));
    return type instanceof PDFName && ['XRef', 'ObjStm'].includes(type.decodeText());
  };
  const dictOf = (object: PDFObject | undefined): PDFDict | undefined =>
    object instanceof PDFDict
      ? object
      : ((object as { dict?: PDFDict } | undefined)?.dict ?? undefined);

  // 1. Objects that existed in the signed revision and are different now (or gone).
  for (const [number, was] of before.objects) {
    const now = after.objects.get(number);
    if (now && sameBytes(bytesOf(was), bytesOf(now))) continue;
    if (isStructural(was)) continue;
    const role = before.roles.get(number);
    const wasDict = dictOf(was);
    const nowDict = dictOf(now);

    switch (role?.type) {
      case 'catalog': {
        const keys = wasDict && nowDict ? changedKeys(lib, wasDict, nowDict) : new Set(['?']);
        for (const key of keys) {
          if (key === 'DSS') add('validation-data');
          else if (key === 'AcroForm') {
            // A direct AcroForm changed: only new fields / flags are fine, they are classified below.
            const a = wasDict?.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
            const b = nowDict?.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
            if (a && b) {
              for (const k of changedKeys(lib, a, b))
                if (k !== 'Fields' && k !== 'SigFlags') add('other');
            }
          } else if (key === 'Metadata') add('metadata');
          else if (key === 'Pages') add('page-structure');
          else add('other'); // including /Perms: tampering with the certification
        }
        break;
      }
      case 'acroform': {
        const keys = wasDict && nowDict ? changedKeys(lib, wasDict, nowDict) : new Set(['?']);
        for (const key of keys) if (key !== 'Fields' && key !== 'SigFlags') add('other');
        break;
      }
      case 'fields':
        // New fields are classified below; a field that disappeared is not an allowed change.
        if (was instanceof PDFArray && now instanceof PDFArray) {
          const kept = new Set<number>();
          for (let i = 0; i < now.size(); i++) {
            const ref = now.get(i);
            if (ref instanceof PDFRef) kept.add(ref.objectNumber);
          }
          for (let i = 0; i < was.size(); i++) {
            const ref = was.get(i);
            if (ref instanceof PDFRef && !kept.has(ref.objectNumber)) add('other');
          }
        } else add('other');
        break;
      case 'pages-node':
        add('page-structure');
        break;
      case 'page': {
        const keys = wasDict && nowDict ? changedKeys(lib, wasDict, nowDict) : new Set(['?']);
        if (keys.has('Annots') && wasDict && nowDict) {
          // A direct /Annots array lives in the page: annotations taken out of it are a change.
          const gone = removedRefs(
            lib,
            wasDict.lookupMaybe(PDFName.of('Annots'), PDFArray),
            nowDict.lookupMaybe(PDFName.of('Annots'), PDFArray),
          );
          for (let i = 0; i < gone; i++) add('annotation');
        }
        keys.delete('Annots'); // additions are classified with the annotations below
        if (keys.size > 0 || !nowDict) add('page-content');
        break;
      }
      case 'annots':
        if (was instanceof PDFArray && now instanceof PDFArray) {
          for (let i = 0; i < removedRefs(lib, was, now); i++) add('annotation');
        } else add('annotation');
        break;
      case 'annotation': {
        const keys = wasDict && nowDict ? changedKeys(lib, wasDict, nowDict) : new Set(['?']);
        const field = role.field;
        if (!nowDict) {
          add('annotation');
        } else if (field?.type === 'Sig') {
          // A signature field of the signed revision: signing it is `signature`, anything else is not.
          const value = nowDict.lookupMaybe(PDFName.of('V'), PDFDict);
          if (keys.has('V') && value) add(signatureKind(lib, value), field.name);
          const rest = [...keys].filter((k) => k !== 'V' && k !== 'AP' && k !== 'MK');
          if (rest.length > 0) add('annotation', field.name);
        } else if (field) {
          const edits = ['V', 'AP', 'MK', 'AS', 'I'];
          if ([...keys].some((k) => edits.includes(k))) add('form-fill', field.name);
          else add('annotation', field.name);
        } else {
          add('annotation');
        }
        break;
      }
      case 'dss':
        add('validation-data');
        break;
      case 'metadata':
        add('metadata');
        break;
      default:
        add('other');
    }
  }

  // 2. What is new: fields (with their widgets), loose annotations and pages.
  if (after.pageCount !== before.pageCount) add('page-structure');
  const knownFields = new Set(
    before.fields.map((f) => f.ref?.objectNumber).filter((n): n is number => n !== undefined),
  );
  const counted = new Set<number>();
  for (const record of after.fields) {
    const number = record.ref?.objectNumber;
    if (number !== undefined && knownFields.has(number)) continue;
    if (number !== undefined) counted.add(number);
    for (let i = 0; record.kids && i < record.kids.size(); i++) {
      const kid = record.kids.get(i);
      if (kid instanceof PDFRef) counted.add(kid.objectNumber);
    }
    if (!record.type && !record.kids) continue;
    if (record.type === 'Sig') {
      const value = record.field.lookupMaybe(PDFName.of('V'), PDFDict);
      add(value ? signatureKind(lib, value) : 'signature-field', record.name, false);
    } else if (record.type) {
      add('form-field', record.name, false);
    }
  }
  for (const [number, role] of after.roles) {
    if (role.type !== 'annotation' || role.field || before.roles.has(number) || counted.has(number))
      continue;
    add('annotation', undefined, false);
  }
  return found;
}

/** Everything about one validation that the analyses share: the final file and the signed revisions. */
export class LaterRevisionsAnalyzer {
  private lib?: Promise<Lib>;
  private after?: Promise<Snapshot | undefined>;
  private readonly before = new Map<number, Promise<Snapshot | undefined>>();

  constructor(private readonly pdf: Uint8Array) {}

  private library(): Promise<Lib> {
    return (this.lib ??= import('pdf-lib'));
  }

  private async load(bytes: Uint8Array): Promise<Snapshot | undefined> {
    try {
      const lib = await this.library();
      const document = await lib.PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      return snapshot(lib, document);
    } catch {
      return undefined; // not a complete revision (or not readable): nothing can be said
    }
  }

  /**
   * What changed after the signature whose signed bytes end at `end`, judged against the
   * restrictions that revision sets (DocMDP and, for `fieldName`, FieldMDP). `undefined` if the
   * signed revision cannot be read as a PDF of its own.
   */
  async analyze(end: number, fieldName: string): Promise<LaterRevisions | undefined> {
    const lib = await this.library();
    const final = await (this.after ??= this.load(this.pdf));
    let signed = this.before.get(end);
    if (!signed) {
      signed = this.load(this.pdf.subarray(0, end));
      this.before.set(end, signed);
    }
    const prefix = await signed;
    if (!final || !prefix) return undefined;

    let records: Record_[];
    try {
      records = classify(lib, prefix, final);
    } catch {
      return undefined;
    }

    const docMdp = readDocMdpPermission(lib, prefix.document);
    const lock = readLock(lib, prefix, fieldName);

    const grouped = new Map<string, LaterChange>();
    for (const r of records) {
      const key = `${r.kind}|${r.field ?? ''}`;
      const current = grouped.get(key);
      grouped.set(key, { kind: r.kind, field: r.field, objects: (current?.objects ?? 0) + 1 });
    }
    const changes = [...grouped.values()].map((c) =>
      c.field === undefined ? { kind: c.kind, objects: c.objects } : c,
    );

    const forbidden: LaterChange[] = [];
    for (const change of changes) {
      const byDocMdp = docMdp !== undefined && !DOC_MDP_ALLOWED[docMdp].has(change.kind);
      // A lock protects the fields that existed when it was signed.
      const existed =
        change.field !== undefined &&
        records.some((r) => r.kind === change.kind && r.field === change.field && r.existed);
      const byLock =
        lock !== undefined &&
        (change.kind === 'form-fill' || change.kind === 'signature') &&
        change.field !== undefined &&
        existed &&
        change.field !== fieldName &&
        lock.covers(change.field);
      if (byDocMdp || byLock) forbidden.push(change);
    }

    return {
      changes,
      ...(docMdp !== undefined ? { docMdp } : {}),
      ...(lock ? { fieldLock: true } : {}),
      forbidden,
      permitted: forbidden.length === 0,
    };
  }
}
