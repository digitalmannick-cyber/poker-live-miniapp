const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function loadVoiceService(callFunction) {
  [
    '../services/voice-service',
    '../utils/cloud',
    '../config/cloud',
  ].forEach((id) => {
    delete require.cache[require.resolve(id)];
  });

  global.wx = {
    cloud: {
      init() {},
      callFunction,
    },
  };

  return require(path.join(root, 'services/voice-service.js'));
}

test('review cloud function retries once after a transport failure', async () => {
  let calls = 0;
  const voiceService = loadVoiceService(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('network timeout');
      error.errMsg = 'cloud.callFunction:fail timeout';
      throw error;
    }
    return {
      result: {
        code: 0,
        provider: 'minimax',
        extractedHand: { streetSummary: 'ok' },
      },
    };
  });

  const result = await voiceService.reviewHandVoice({ transcript: 'test' });

  assert.equal(calls, 2);
  assert.equal(result.provider, 'minimax');
  assert.equal(result.extractedHand.streetSummary, 'ok');
});

test('review cloud function does not retry business-level nonzero results', async () => {
  let calls = 0;
  const voiceService = loadVoiceService(async () => {
    calls += 1;
    return {
      result: {
        code: 'INVALID_MINIMAX_JSON',
        message: 'MiniMax 返回的不是有效 JSON',
      },
    };
  });

  const result = await voiceService.reviewHandVoice({ transcript: 'test' });

  assert.equal(calls, 1);
  assert.equal(result.code, 'INVALID_MINIMAX_JSON');
});
