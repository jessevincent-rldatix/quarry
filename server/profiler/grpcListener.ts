import * as grpc from '@grpc/grpc-js'
import { decodeProtobuf, type Span } from './otlp.ts'

/**
 * Accepts traces over gRPC, which is how the backend exports them out of the box. Listening on the
 * port its local settings already point at means `dotnet run` needs no changes to be recorded.
 */
export function startGrpcListener(port: number, onSpans: (spans: Span[]) => void): Promise<string | undefined> {
  const server = new grpc.Server({ 'grpc.max_receive_message_length': 64 * 1024 * 1024 })
  server.addService({
    Export: {
      path: '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
      requestStream: false, responseStream: false,
      requestSerialize: (value: Buffer) => value, requestDeserialize: (bytes: Buffer) => bytes,
      // An empty reply means "all accepted".
      responseSerialize: () => Buffer.alloc(0), responseDeserialize: () => ({}),
    },
  }, {
    Export: (call: grpc.ServerUnaryCall<Buffer, object>, done: grpc.sendUnaryData<object>) => {
      try {
        onSpans(decodeProtobuf(call.request))
      } catch (err) {
        console.error('Could not read a trace export:', err)
      }
      done(null, {})
    },
  })
  return new Promise((resolve) => {
    server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
      resolve(err ? `Port ${port} is not available (${err.message}). Something else may already be collecting traces there.` : undefined)
    })
  })
}
