'use strict';

var path = require('path'),
  http = require('http'),
  _ = require('lodash'),
  bunyan = require('bunyan'),
  uuid = require('uuid');

function reqSerializer(ctx) {
  return {
    url: ctx.url,
    headers: ctx.request.header,
    method: ctx.method,
    ip: ctx.ip,
    protocol: ctx.protocol,
    originalUrl: ctx.originalUrl,
    query: ctx.query
  };
}

function resSerializer(ctx) {
  return {
    statusCode: ctx.status,
    responseTime: ctx.responseTime,
    headers: ctx.response.header
  };
}

function uidSerializer() {
  return uuid.v4();
}

function log(serializers, ctx) {
  var data = {};

  for (var i in serializers) {
    data[i] = ctx;
  }

  return data;
}

var configDefaults = {
  name: 'app',
  path: 'log',
  jsonapi: false,
  isJsonApi: function () {
    return this.jsonapi;
  },
  outStreams: null,
  errStreams: null
};

module.exports = function koaLogger(opts) {

  opts = opts || {};

  var config = _.defaults(opts, configDefaults),
    env = process.env.NODE_ENV;

  var outStream = { level: 'info' };
  if (config.path === null) {
    outStream.stream = process.stdout;
  }
  else {
    outStream.path = path.join(config.path, config.name + '.log');
  }

  // Standard Logger
  var outSerializers = _.extend({
    uid: uidSerializer,
    req: reqSerializer,
    res: resSerializer
  }, config.serializers);
  var outLogger = bunyan.createLogger({

    name: config.name,

    serializers: outSerializers,

    streams: [outStream].concat(config.outStreams || [])
  });

  var errStream = { level: 'error' };
  if (config.path === null) {
    errStream.stream = process.stderr;
  }
  else {
    errStream.path = path.join(config.path, config.name + '_error.log');
  }

  // Error Logger
  var errSerializers = _.extend({
    uid: uidSerializer,
    req: reqSerializer,
    res: resSerializer,
    err: bunyan.stdSerializers.err
  }, config.serializers);
  var errLogger = bunyan.createLogger({

    name: config.name,

    serializers: errSerializers,

    streams: [errStream].concat(config.errStreams || [])
  });

  return function *logger(next) {

    var ctx = this,
      start = new Date();

    // If logging for a JSON API set the response Content-type before logging is done so the header  is correctly logged
    if (config.isJsonApi()) {
      ctx.response.type = 'application/vnd.api+json';
    }

    try {
      yield next;

      ctx.responseTime = new Date() - start;

      outLogger.info(log(outSerializers, ctx));
    }
    catch (err) {

      // Response properties
      ctx.status = err.status || 500;
      ctx.responseTime = new Date() - start;

      // Handle 500 errors - do not leak internal server error message to the user.
      // Standard error response message for user
      var message, details;
      if (env === 'production') {
        message = ctx.status === 500 ? http.STATUS_CODES[ctx.status] : err.message;
        details = err.details || null;
      } else {
        message = err.message;
        details = err.details || err.stack;
      }

      if (config.isJsonApi()) {
        ctx.body = { error: message, details: details };
      } else {
        ctx.body = details || message;
      }

      // log error message and stack trace
      errLogger.error(log(errSerializers, ctx));

      // Console output in development only
      if (env === 'development') {
        ctx.app.emit('error', err, this);
      }

    }

    /*
    Currently - if a nested object is thrown the Content-type is set to 'application/json'
    Example:
    this.throw(401, {
      message: {
        status: 401,
        title: 'Unauthorized',
        detail: 'No Authorization header found'
      }
    })
    If JSON API is enabled to work around this we need to set the response Content-type again
    */
    if (config.isJsonApi()) {
      ctx.response.type = 'application/vnd.api+json';
    }

  };

};

module.exports.serializers = {
  uid: uidSerializer,
  req: reqSerializer,
  res: resSerializer,
  err: bunyan.stdSerializers.err
};
