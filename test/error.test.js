'use strict';

var path         = require('path')
  , chai         = require('chai')
  , expect       = chai.expect
  , should       = chai.should()
  , helper       = require(path.join(__dirname, 'lib', 'agent_helper'))
  , config       = require(path.join(__dirname, '..', 'lib', 'config.default'))
  , dominion     = require(path.join(__dirname, '..', 'lib', 'dominion'))
  , ErrorTracer  = require(path.join(__dirname, '..', 'lib', 'error'))
  , Transaction  = require(path.join(__dirname, '..', 'lib', 'transaction'))
  ;

function createTransaction(code) {
  return { statusCode : code, exceptions : [] };
}

describe("ErrorTracer", function () {
  var tracer;

  beforeEach(function () {
    tracer = new ErrorTracer(config.config);
  });

  it("shouldn't gather errors if it's switched off", function () {
    var error = new Error('this error will never be seen');
    tracer.config.error_collector.enabled = false;

    expect(tracer.errorCount).equal(0);
    expect(tracer.errors.length).equal(0);

    tracer.add(null, error);

    expect(tracer.errorCount).equal(1);
    expect(tracer.errors.length).equal(0);

    tracer.config.error_collector.enabled = true;
  });

  it("should retain a maximum of 20 errors to send", function () {
    for (var i = 0; i < 5; i++) tracer.add(null, new Error('filling the queue'));
    expect(tracer.errors.length).equal(5);

    for (i = 0; i < 5; i++) tracer.add(null, new Error('more filling the queue'));
    expect(tracer.errors.length).equal(10);

    // this will take the tracer 3 over the limit of 20
    for (i = 0; i < 13; i++) tracer.add(null, new Error('overfilling the queue'));
    expect(tracer.errorCount).equal(23);
    expect(tracer.errors.length).equal(20);
  });

  it("should handle errors properly for transactions", function () {
    tracer.onTransactionFinished(createTransaction(400));
    tracer.onTransactionFinished(createTransaction(500));

    expect(tracer.errors.length).equal(2);
    expect(tracer.errorCount).equal(2);
  });

  it("should ignore 404 errors for transactions", function () {
    tracer.onTransactionFinished(createTransaction(400));
    // 404 errors are ignored by default
    tracer.onTransactionFinished(createTransaction(404));
    tracer.onTransactionFinished(createTransaction(404));
    tracer.onTransactionFinished(createTransaction(404));
    tracer.onTransactionFinished(createTransaction(404));

    expect(tracer.errorCount).equal(1);
  });

  describe("with no exception and no transaction", function () {
    var agent;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      var tracer = agent.errors;

      tracer.add(new Transaction (agent), null);
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have no errors", function () {
      agent.errors.add(null, null);
      expect(agent.errors.errors.length).equal(0);
    });
  });

  describe("with no error and a transaction with status code", function () {
    var agent
      , tracer
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      tracer.add(new Transaction (agent), null);
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have no errors", function () {
      expect(tracer.errors.length).equal(0);
    });
  });

  describe("with no error and a transaction with a status code", function () {
    var agent
      , tracer
      , errorJSON
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var transaction = new Transaction (agent);
      transaction.statusCode = 503; // PDX wut wut

      tracer.add(transaction, null);
      errorJSON = tracer.errors[0];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have one error", function () {
      expect(tracer.errors.length).equal(1);
    });

    it("shouldn't care what time it was traced", function () {
      expect(errorJSON[0]).equal(0);
    });

    it("should have the default scope", function () {
      expect(errorJSON[1]).equal('WebTransaction/Uri/*');
    });

    it("should have an HTTP status code error message", function () {
      expect(errorJSON[2]).equal('HttpError 503');
    });

    it("should default to a type of Error", function () {
      expect(errorJSON[3]).equal('Error');
    });

    it("should not have a stack trace in the params", function () {
      var params = errorJSON[4];
      should.not.exist(params.stack_trace);
    });
  });

  describe("with no error and a transaction with an URL and status code", function () {
    var agent
      , tracer
      , errorJSON
      , params
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var transaction = new Transaction(agent);
      transaction.statusCode = 501;

      transaction.url = '/test_action.json?test_param=a%20value&thing';

      tracer.add(transaction, null);
      errorJSON = tracer.errors[0];
      params = errorJSON[4];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have one error", function () {
      expect(tracer.errors.length).equal(1);
    });

    it("shouldn't care what time it was traced", function () {
      expect(errorJSON[0]).equal(0);
    });

    it("should have the URL's scope", function () {
      expect(errorJSON[1]).equal('WebTransaction/Uri/test_action.json');
    });

    it("should have an HTTP status code message", function () {
      expect(errorJSON[2]).equal("HttpError 501");
    });

    it("should default to  a type of Error", function () {
      expect(errorJSON[3]).equal('Error');
    });

    it("should not have a stack trace in the params", function () {
      should.not.exist(params.stack_trace);
    });

    it("should have a request URL", function () {
      expect(params.request_uri = '/test_action.json');
    });

    it("should parse out the first URL parameter", function () {
      expect(params.request_params.test_param).equal('a value');
    });

    it("should parse out the other URL parameter", function () {
      expect(params.request_params.thing).equal(true);
    });
  });

  describe("with a thrown TypeError object and no transaction", function () {
    var agent
      , tracer
      , errorJSON
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var exception = new Error('Dare to be the same!');

      tracer.add(null, exception);
      errorJSON = tracer.errors[0];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have one error", function () {
      expect(tracer.errors.length).equal(1);
    });

    it("shouldn't care what time it was traced", function () {
      expect(errorJSON[0]).equal(0);
    });

    it("should have the default scope", function () {
      expect(errorJSON[1]).equal('WebTransaction/Uri/*');
    });

    it("should fish the message out of the exception", function () {
      expect(errorJSON[2]).equal("Dare to be the same!");
    });

    it("should have a type of TypeError", function () {
      expect(errorJSON[3]).equal('Error');
    });

    it("should have a stack trace in the params", function () {
      var params = errorJSON[4];
      should.exist(params.stack_trace);
      expect(params.stack_trace[0]).equal("Error: Dare to be the same!");
    });
  });

  describe("with a thrown TypeError object and a transaction with no URL", function () {
    var agent
      , tracer
      , errorJSON
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var transaction = new Transaction(agent)
        , exception   = new TypeError('Dare to be different!')
        ;

      tracer.add(transaction, exception);
      errorJSON = tracer.errors[0];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have one error", function () {
      expect(tracer.errors.length).equal(1);
    });

    it("shouldn't care what time it was traced", function () {
      expect(errorJSON[0]).equal(0);
    });

    it("should have the default scope", function () {
      expect(errorJSON[1]).equal('WebTransaction/Uri/*');
    });

    it("should fish the message out of the exception", function () {
      expect(errorJSON[2]).equal("Dare to be different!");
    });

    it("should have a type of TypeError", function () {
      expect(errorJSON[3]).equal('TypeError');
    });

    it("should have a stack trace in the params", function () {
      var params = errorJSON[4];
      should.exist(params.stack_trace);
      expect(params.stack_trace[0]).equal("TypeError: Dare to be different!");
    });
  });

  describe("with a thrown TypeError object and a transaction with an URL", function () {
    var agent
      , tracer
      , errorJSON
      , params
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var transaction = new Transaction(agent)
        , exception   = new TypeError('wanted JSON, got XML')
        ;

      transaction.url = '/test_action.json?test_param=a%20value&thing';

      tracer.add(transaction, exception);
      errorJSON = tracer.errors[0];
      params = errorJSON[4];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have one error", function () {
      expect(tracer.errors.length).equal(1);
    });

    it("shouldn't care what time it was traced", function () {
      expect(errorJSON[0]).equal(0);
    });

    it("should have the URL's scope", function () {
      expect(errorJSON[1]).equal('WebTransaction/Uri/test_action.json');
    });

    it("should fish the message out of the exception", function () {
      expect(errorJSON[2]).equal("wanted JSON, got XML");
    });

    it("should have a type of TypeError", function () {
      expect(errorJSON[3]).equal('TypeError');
    });

    it("should have a stack trace in the params", function () {
      should.exist(params.stack_trace);
      expect(params.stack_trace[0]).equal("TypeError: wanted JSON, got XML");
    });

    it("should have a request URL", function () {
      expect(params.request_uri = '/test_action.json');
    });

    it("should parse out the first URL parameter", function () {
      expect(params.request_params.test_param).equal('a value');
    });

    it("should parse out the other URL parameter", function () {
      expect(params.request_params.thing).equal(true);
    });
  });

  describe("with a thrown string and a transaction with no URL", function () {
    var agent
      , tracer
      , errorJSON
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var transaction = new Transaction(agent)
        , exception   = 'Dare to be different!'
        ;

      tracer.add(transaction, exception);
      errorJSON = tracer.errors[0];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have one error", function () {
      expect(tracer.errors.length).equal(1);
    });

    it("shouldn't care what time it was traced", function () {
      expect(errorJSON[0]).equal(0);
    });

    it("should have the default scope", function () {
      expect(errorJSON[1]).equal('WebTransaction/Uri/*');
    });

    it("should turn the string into the message", function () {
      expect(errorJSON[2]).equal("Dare to be different!");
    });

    it("should default to a type of Error", function () {
      expect(errorJSON[3]).equal('Error');
    });

    it("should have no stack trace", function () {
      should.not.exist(errorJSON[4].stack_trace);
    });
  });

  describe("with a thrown string and a transaction with an URL", function () {
    var agent
      , tracer
      , errorJSON
      , params
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var transaction = new Transaction(agent)
        , exception   = 'wanted JSON, got XML'
        ;

      transaction.url = '/test_action.json?test_param=a%20value&thing';

      tracer.add(transaction, exception);
      errorJSON = tracer.errors[0];
      params = errorJSON[4];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should have one error", function () {
      expect(tracer.errors.length).equal(1);
    });

    it("shouldn't care what time it was traced", function () {
      expect(errorJSON[0]).equal(0);
    });

    it("should have the URL's scope", function () {
      expect(errorJSON[1]).equal('WebTransaction/Uri/test_action.json');
    });

    it("should turn the string into the message", function () {
      expect(errorJSON[2]).equal("wanted JSON, got XML");
    });

    it("should default to a type of Error", function () {
      expect(errorJSON[3]).equal('Error');
    });

    it("should not have a stack trace in the params", function () {
      should.not.exist(params.stack_trace);
    });

    it("should have a request URL", function () {
      expect(params.request_uri = '/test_action.json');
    });

    it("should parse out the first URL parameter", function () {
      expect(params.request_params.test_param).equal('a value');
    });

    it("should parse out the other URL parameter", function () {
      expect(params.request_params.thing).equal(true);
    });
  });

  describe("with an internal server error (500) and an exception", function () {
    var agent
      , scope = 'WebTransaction/Uri/test-request/zxrkbl'
      , error
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var transaction = new Transaction(agent)
        , exception   = new Error('500 test error')
        ;

      transaction.exceptions.push(exception);
      transaction.setWeb('/test-request/zxrkbl',
                         'WebTransaction/Uri/test-request/zxrkbl',
                         500);
      transaction.end();

      error = tracer.errors[0];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should associate errors with the transaction's scope", function () {
      var errorScope = error[1];

      expect(errorScope).equal(scope);
    });

    it("should associate errors with a message", function () {
      var message = error[2];

      expect(message).match(/500 test error/);
    });

    it("should associate errors with a message class", function () {
      var messageClass = error[3];

      expect(messageClass).equal('Error');
    });

    it("should associate errors with parameters", function () {
      var params = error[4];

      should.exist(params);
      expect(Object.keys(params).length).equal(2);
      expect(params.request_uri).equal("/test-request/zxrkbl");

      should.exist(params.stack_trace);
      expect(params.stack_trace[0]).equal("Error: 500 test error");
    });
  });

  describe("with a tracer unavailable (503) error", function () {
    var agent
      , scope = 'WebTransaction/Uri/test-request/zxrkbl'
      , error
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      tracer = agent.errors;

      var transaction = new Transaction(agent);
      transaction.setWeb('/test-request/zxrkbl',
                         'WebTransaction/Uri/test-request/zxrkbl',
                         503);
      transaction.end();

      error = tracer.errors[0];
    });

    afterEach(function () {
      helper.unloadAgent(agent);
    });

    it("should associate errors with the transaction's scope", function () {
      var errorScope = error[1];

      expect(errorScope).equal(scope);
    });

    it("should associate errors with a message", function () {
      var message = error[2];

      expect(message).equal('HttpError 503');
    });

    it("should associate errors with an error type", function () {
      var messageClass = error[3];

      expect(messageClass).equal('Error');
    });

    it("should associate errors with parameters", function () {
      var params = error[4];

      expect(params).deep.equal({request_uri : "/test-request/zxrkbl"});
    });
  });

  describe("when monitoring function application for errors", function () {
    var agent
      , transaction
      , mochaHandlers
      ;

    beforeEach(function () {
      agent = helper.loadMockedAgent();
      transaction = new Transaction(agent);
      mochaHandlers = helper.onlyDomains();
    });

    afterEach(function () {
      transaction.end();
      helper.unloadAgent(agent);
      process._events['uncaughtException'] = mochaHandlers;
    });

    it("should rethrow the exception", function () {
      var testFunction = function () {
        var uninitialized;
        uninitialized.explosion.happens.here = "fabulous";
      };

      expect(function () {
        tracer.monitor(testFunction, transaction);
      }).throws(TypeError);
    });

    it("should return the correct value", function () {
      var safeFunction = function (val) {
        return val * val;
      };

      expect(tracer.monitor(safeFunction.bind(null, 3), transaction)).equal(9);
    });
  });

  describe("when merging from failed collector delivery", function () {
    it("shouldn't crash on null errors", function () {
      expect(function () { tracer.merge(null); }).not.throws();
    });

    it("should never merge more than 20 errors", function () {
      var sample = [0, 'WebTransaction/Uri/*', 'something bad happened', 'Error', {}];
      var errors = [];
      for (var i = 0; i < 30; i++) errors.push(sample);

      tracer.merge(errors);

      expect(tracer.errors.length).equal(20);
    });
  });

  if (dominion.available) {
    describe("when domains are available", function () {
      var mochaHandlers
        , agent
        , transaction
        , domain
        , active
        , json
        ;

      before(function (done) {
        agent = helper.loadMockedAgent();

        /**
         * Mocha is extremely zealous about trapping errors, and runs each test
         * in a try / catch block. To get the exception to propagate out to the
         * domain's uncaughtException handler, we need to put the test in an
         * asynchronous context and break out of the mocha jail.
         */
        process.nextTick(function () {
          // disable mocha's error handler
          mochaHandlers = helper.onlyDomains();

          process.once('uncaughtException', function () {
            json = agent.errors.errors[0];

            return done();
          });

          var disruptor = agent.tracer.transactionProxy(function () {
            transaction = agent.getTransaction();
            domain = transaction.trace.domain;
            active = process.domain;

            // trigger the domain
            throw new Error('sample error');
          });

          disruptor();
        });
      });

      after(function () {
        // ...but be sure to re-enable mocha's error handler
        transaction.end();
        helper.unloadAgent(agent);
        process._events['uncaughtException'] = mochaHandlers;
      });

      it("should bind domain to trace", function () {
        should.exist(domain);
      });

      it("should have a domain active", function () {
        should.exist(active);
      });

      it("the error-handling domain should be the active domain", function () {
        expect(domain).equal(active);
      });

      it("should find a single error", function () {
        expect(agent.errors.errors.length).equal(1);
      });

      describe("and an error is traced", function () {
        it("should find the error", function () {
          should.exist(json);
        });

        it("should have 5 elements in the trace", function () {
          expect(json.length).equal(5);
        });

        it("should always have a 0 (ignored) timestamp", function () {
          expect(json[0]).equal(0);
        });

        it("should have the default scope", function () {
          expect(json[1]).equal('WebTransaction/Uri/*');
        });

        it("should have the error's message", function () {
          expect(json[2]).equal('sample error');
        });

        it("should have the error's constructor name (type)", function () {
          expect(json[3]).equal('Error');
        });

        it("should default to passing the stack trace as a parameter", function () {
          var params = json[4];

          should.exist(params);
          expect(Object.keys(params).length).equal(1);
          should.exist(params.stack_trace);
          expect(params.stack_trace[0]).equal("Error: sample error");
        });
      });
    });
  }
});
