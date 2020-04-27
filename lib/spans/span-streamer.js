'use strict'

const logger = require('../logger').child({component: 'span-streamer'})

// const NAMES = require('../metrics/names')

const NO_STREAM_WARNING =
  'Attempting to stream spans before connection created. ' +
  'This warning will not appear again this agent run.'

// const BACK_PRESSURE_WARNING =
//   'Back pressure detected in SpanStreamer! Spans will be dropped until the current batch ' +
//   'has fully sent. Will not warn again for %s seconds.'
// const BACK_PRESSURE_WARNING_INTERVAL = 60 // in seconds

// const BACK_PRESSURE_STOP = 'Back pressure has ended, continuing to stream'

const {Readable} = require('stream')

class SpanStreamer {
  constructor(license_key, connection, metrics) {
    this.stream = null
    this.license_key = license_key
    this.connection = connection
    this._metrics = metrics
    this._writable = false

    this.spans = []
    this.readableStream = new Readable({objectMode: true, read: this._streamRead.bind(this)})

    // 'connected' indicates a safely writeable stream.
    // May still be mid-connect to gRPC server.
    this.connection.on('connected', (stream) =>{
      this.stream = stream
      this._writable = true

      logger.trace('piping readable stream to write stream')
      // Make the magic happen.
      // The writeable stream will automatically pull items
      // from the readable stream while it can write and will stop
      // during backpressure situations.
      this.readableStream.pipe(this.stream)
    })

    this.connection.on('disconnected', () =>{
      logger.trace('unpiping readable stream from disconnected write stream')

      this.readableStream.unpipe(this.stream)

      this.stream = null
      this._writable = false
    })
  }

  _streamRead(size) {
    this._pushSpans(size)
  }

  _pushSpans() {
    this.stoppedStreaming = false

    if (this.shouldEnd) { // may want to keep track of some reason we are done
      this.readableStream.push(null)
      return
    }

    this.canPush = true // this may be unecessary
    while (this.spans.length > 0) {
      // TODO: is shift slow?
      const nextObject = this.spans.shift()

      // This is where we prob should increment SENT
      this.canPush = this.readableStream.push(nextObject)

      if (nextObject === null || !this.canPush) {
        this.canPush = false
        return
      }
    }

    // when we run out of items, the pipe will stop auto reading due
    // the _read call not resulting in a push. so we flag that to force
    // functioning again
    this.stoppedStreaming = true
  }

  write(span) {
    if (!this.stream) {
      logger.warnOnce(NO_STREAM_WARNING)
      return false
    }

    const MAX_SPANS = 5000
    if (this.spans.length >= MAX_SPANS) {
      // This is just to help make clear drops due to backing up the queue
      this._metrics.getOrCreateMetric('Supportability/InfiniteTracing/Span/Dropped')
        .incrementCallCount()
      return false
    }

    this.spans.push(span.toStreamingFormat())

    // When we run out of spans to read, the stream will stop flowing
    // and won't auto-resume, so we force the issue.
    // Don't force push during backpressure, write resume will continue reads.
    if (this.canPush && this.stoppedStreaming) {
      this._pushSpans()
    }

    return true

    // TODO: return true ? which will only be an approximation

    // if (!this._writable) {
    //   return false
    // }

    // const formattedSpan = span.toStreamingFormat()

    // try {
    //   // false indicates the stream has reached the highWaterMark
    //   // and future writes should be avoided until drained. written items,
    //   // including the one that returned false, will still be buffered.
    //   this._writable = this.stream.write(formattedSpan)

    //   if (!this._writable) {
    //     logger.infoOncePer(
    //       'BACK_PRESSURE_START',
    //       BACK_PRESSURE_WARNING_INTERVAL * 1000,
    //       BACK_PRESSURE_WARNING,
    //       BACK_PRESSURE_WARNING_INTERVAL
    //     )

    //     const waitDrainStart = Date.now()

    //     this.stream.once('drain', () => {
    //       const drainCompleted = Date.now()
    //       const drainDurationMs = drainCompleted - waitDrainStart

    //       // Metric can be used to see how frequently completing drains
    //       // as well as average time to drain from when we first notice.
    //       this._metrics.getOrCreateMetric(NAMES.INFINITE_TRACING.DRAIN_DURATION)
    //         .recordValue(drainDurationMs / 1000)

    //       logger.trace(BACK_PRESSURE_STOP)
    //       this._writable = true
    //     })
    //   }

    //   // span was added to internal node stream buffer to be sent while draining
    //   // so we return true even when we should not write anymore afterwards
    //   return true
    // } catch (err) {
    //   logger.trace('Could not stream span.', err)
    //   // TODO: something has gone horribly wrong.
    //   // We may want to log and turn off this aggregator
    //   // to prevent sending further spans. Maybe even "disable" their creation?
    //   // or is there a situation where we can recover?

    //   return false
    // }
  }

  connect(agent_run_id) {
    this.connection.setConnectionDetails(
      this.license_key,
      agent_run_id
    )

    this.connection.connectSpans()
  }

  disconnect() {
    this.connection.disconnect()
  }
}

module.exports = SpanStreamer
