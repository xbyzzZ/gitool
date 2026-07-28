import { resolve } from 'node:path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    color: true,
    timeout: 30_000,
    ui: 'tdd',
  });
  mocha.addFile(resolve(__dirname, 'extension.test.js'));

  await new Promise<void>((resolveTests, rejectTests) => {
    mocha.run((failures) => {
      if (failures === 0) {
        resolveTests();
        return;
      }
      rejectTests(new Error(`${String(failures)} 个扩展测试失败`));
    });
  });
}
