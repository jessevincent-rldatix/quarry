import protobuf from 'protobufjs'

/**
 * Reads OpenTelemetry trace exports (OTLP), the format the backend already sends its traces in.
 * Only the fields the profiler uses are declared; anything else in a message is skipped.
 */
export interface Span {
  traceId: string
  spanId: string
  parentId: string
  name: string
  /** 2 is a request the service received, 3 a call it made. */
  kind: number
  startMs: number
  endMs: number
  attributes: Record<string, string | number | boolean>
  /** 2 means the span ended in an error. */
  statusCode: number
}

export const SPAN_KIND_SERVER = 2

const anyValue = {
  fields: {
    stringValue: { type: 'string', id: 1 }, boolValue: { type: 'bool', id: 2 }, intValue: { type: 'int64', id: 3 },
    doubleValue: { type: 'double', id: 4 }, bytesValue: { type: 'bytes', id: 7 },
  },
}

const root = protobuf.Root.fromJSON({
  nested: {
    ExportTraceServiceRequest: { fields: { resourceSpans: { rule: 'repeated', type: 'ResourceSpans', id: 1 } } },
    ResourceSpans: { fields: { scopeSpans: { rule: 'repeated', type: 'ScopeSpans', id: 2 } } },
    ScopeSpans: { fields: { spans: { rule: 'repeated', type: 'Span', id: 2 } } },
    Span: {
      fields: {
        traceId: { type: 'bytes', id: 1 }, spanId: { type: 'bytes', id: 2 }, parentSpanId: { type: 'bytes', id: 4 },
        name: { type: 'string', id: 5 }, kind: { type: 'int32', id: 6 },
        startTimeUnixNano: { type: 'fixed64', id: 7 }, endTimeUnixNano: { type: 'fixed64', id: 8 },
        attributes: { rule: 'repeated', type: 'KeyValue', id: 9 }, status: { type: 'Status', id: 15 },
      },
    },
    Status: { fields: { message: { type: 'string', id: 2 }, code: { type: 'int32', id: 3 } } },
    KeyValue: { fields: { key: { type: 'string', id: 1 }, value: { type: 'AnyValue', id: 2 } } },
    AnyValue: anyValue,
  },
})
const Request = root.lookupType('ExportTraceServiceRequest')

type RawValue = { stringValue?: string; boolValue?: boolean; intValue?: string | number; doubleValue?: number }
type RawSpan = {
  traceId?: string; spanId?: string; parentSpanId?: string; name?: string; kind?: number | string
  startTimeUnixNano?: string | number; endTimeUnixNano?: string | number
  attributes?: { key: string; value?: RawValue }[]; status?: { code?: number | string }
}
type RawRequest = { resourceSpans?: { scopeSpans?: { spans?: RawSpan[] }[] }[] }

// Nanoseconds since 1970 do not fit a JavaScript number exactly, so divide as a big integer first.
const toMs = (nanos: string | number | undefined) => Number(BigInt(nanos ?? 0) / 1000n) / 1000

const KINDS: Record<string, number> = { SPAN_KIND_INTERNAL: 1, SPAN_KIND_SERVER: 2, SPAN_KIND_CLIENT: 3 }
const STATUS: Record<string, number> = { STATUS_CODE_OK: 1, STATUS_CODE_ERROR: 2 }

function value(raw: RawValue | undefined): string | number | boolean | undefined {
  if (!raw) return undefined
  if (raw.stringValue !== undefined) return raw.stringValue
  if (raw.boolValue !== undefined) return raw.boolValue
  if (raw.intValue !== undefined) return Number(raw.intValue)
  if (raw.doubleValue !== undefined) return raw.doubleValue
  return undefined
}

function spans(request: RawRequest, idsAre: 'hex' | 'base64'): Span[] {
  const id = (text: string | undefined) => (!text ? '' : idsAre === 'hex' ? text.toLowerCase() : Buffer.from(text, 'base64').toString('hex'))
  const out: Span[] = []
  for (const resource of request.resourceSpans ?? []) {
    for (const scope of resource.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        const attributes: Span['attributes'] = {}
        for (const pair of span.attributes ?? []) {
          const v = value(pair.value)
          if (v !== undefined) attributes[pair.key] = v
        }
        out.push({
          traceId: id(span.traceId), spanId: id(span.spanId), parentId: id(span.parentSpanId), name: span.name ?? '',
          kind: typeof span.kind === 'string' ? KINDS[span.kind] ?? 0 : span.kind ?? 0,
          startMs: toMs(span.startTimeUnixNano), endMs: toMs(span.endTimeUnixNano), attributes,
          statusCode: typeof span.status?.code === 'string' ? STATUS[span.status.code] ?? 0 : span.status?.code ?? 0,
        })
      }
    }
  }
  return out
}

/** The binary form, used by both gRPC and http/protobuf. */
export function decodeProtobuf(body: Uint8Array): Span[] {
  const message = Request.toObject(Request.decode(body), { longs: String, bytes: String, defaults: false }) as RawRequest
  return spans(message, 'base64')
}

/** The JSON form (http/json), where ids are already hex. */
export function decodeJson(body: unknown): Span[] {
  return spans(body as RawRequest, 'hex')
}
