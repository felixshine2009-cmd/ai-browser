'use strict';
// kept for compatibility: macOS arm64 staging lives in stage.js
const m = require('./stage');
module.exports = { stage: () => m.stage('mac-arm64'), STAGE: m.STAGE };
if (require.main === module) m.stage('mac-arm64');
