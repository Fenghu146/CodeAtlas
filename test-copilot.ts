import { SQLiteStore } from '@codeatlas/core';
import { GraphCopilot } from '@codeatlas/core';
import * as path from 'path';

async function testCopilot() {
  const dbPath = path.join(__dirname, 'packages/core/.codeatlas/db.sqlite');

  try {
    const store = await SQLiteStore.create({ dbPath });
    const copilot = new GraphCopilot(store, __dirname);

    console.log('=== CodeAtlas Copilot 测试 ===\n');

    // 测试1: 项目概览
    console.log('1. 测试项目概览...');
    const overview = await copilot.ask('Give me an overview of the project');
    console.log('意图识别:', overview.intent, '(置信度:', overview.confidence + ')');
    console.log('回答:', overview.answer);
    console.log('耗时:', overview.duration + 'ms\n');

    // 测试2: 理解代码
    console.log('2. 测试理解代码...');
    const understand = await copilot.ask('What does SQLiteStore do?');
    console.log('意图识别:', understand.intent, '(置信度:', understand.confidence + ')');
    console.log('回答:', understand.answer);
    console.log('耗时:', understand.duration + 'ms\n');

    // 测试3: 影响分析
    console.log('3. 测试影响分析...');
    const impact = await copilot.ask('What happens if I change SQLiteStore?');
    console.log('意图识别:', impact.intent, '(置信度:', impact.confidence + ')');
    console.log('回答:', impact.answer);
    console.log('耗时:', impact.duration + 'ms\n');

    // 测试4: 安全删除分析
    console.log('4. 测试安全删除分析...');
    const safeDelete = await copilot.ask('Can I safely delete SQLiteStore?');
    console.log('意图识别:', safeDelete.intent, '(置信度:', safeDelete.confidence + ')');
    console.log('回答:', safeDelete.answer);
    console.log('耗时:', safeDelete.duration + 'ms\n');

    // 测试5: 中文意图识别
    console.log('5. 测试中文意图识别...');
    const chinese = await copilot.ask('解释一下 SQLiteStore 是做什么的');
    console.log('意图识别:', chinese.intent, '(置信度:', chinese.confidence + ')');
    console.log('回答:', chinese.answer);
    console.log('耗时:', chinese.duration + 'ms\n');

    // 测试6: 查找代码
    console.log('6. 测试查找代码...');
    const findCode = await copilot.ask('Where is the code that handles scanning?');
    console.log('意图识别:', findCode.intent, '(置信度:', findCode.confidence + ')');
    console.log('回答:', findCode.answer);
    console.log('耗时:', findCode.duration + 'ms\n');

    // 测试7: 调用链分析
    console.log('7. 测试调用链分析...');
    const callChain = await copilot.ask('Who calls SQLiteStore?');
    console.log('意图识别:', callChain.intent, '(置信度:', callChain.confidence + ')');
    console.log('回答:', callChain.answer);
    console.log('耗时:', callChain.duration + 'ms\n');

    // 测试8: 架构分析
    console.log('8. 测试架构分析...');
    const architecture = await copilot.ask('What is the architecture of this project?');
    console.log('意图识别:', architecture.intent, '(置信度:', architecture.confidence + ')');
    console.log('回答:', architecture.answer);
    console.log('耗时:', architecture.duration + 'ms\n');

    store.close();
    console.log('=== 测试完成 ===');

  } catch (error) {
    console.error('测试失败:', error);
  }
}

testCopilot();