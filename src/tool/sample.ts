// 预览页（preview.html）用的示例状态：一张虚构软件的英文设置截图，以及识别和翻译结果。不会进入正式运行。

export const SAMPLE_NAME = '示例-同步设置截图.png';

export const SAMPLE_SEGMENTS = [
  'Sync settings',
  'Your notes are saved on this device. Turn on sync to keep them up to date on your phone and computer.',
  'Sync pauses automatically when the battery is below 20% or when you are on a metered connection.',
  'Last synced: today at 10:42',
];

export const SAMPLE_TRANSLATIONS = [
  '同步设置',
  '你的笔记保存在这台设备上。打开同步后，手机和电脑上的笔记会保持一致。',
  '电量低于 20% 或使用按流量计费的网络时，同步会自动暂停。',
  '上次同步：今天 10:42',
];

/** 画一张示例截图（白色对话框 + 英文说明 + 开关），返回 data: 地址 */
export function sampleImage(): string {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 420;
  const g = c.getContext('2d')!;
  g.fillStyle = '#EEF1F5';
  g.fillRect(0, 0, 900, 420);
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.roundRect(40, 30, 820, 360, 18);
  g.fill();
  g.fillStyle = '#1F2937';
  g.font = '600 34px -apple-system, "Segoe UI", sans-serif';
  g.fillText('Sync settings', 80, 96);
  g.font = '24px -apple-system, "Segoe UI", sans-serif';
  g.fillStyle = '#374151';
  g.fillText('Your notes are saved on this device. Turn on sync to keep', 80, 156);
  g.fillText('them up to date on your phone and computer.', 80, 190);
  g.fillText('Sync pauses automatically when the battery is below 20%', 80, 248);
  g.fillText('or when you are on a metered connection.', 80, 282);
  g.fillStyle = '#6B7280';
  g.font = '22px -apple-system, "Segoe UI", sans-serif';
  g.fillText('Last synced: today at 10:42', 80, 346);
  g.fillStyle = '#22A06B';
  g.beginPath();
  g.roundRect(744, 66, 76, 40, 20);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(800, 86, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#B45309';
  g.font = '600 18px -apple-system, "PingFang SC", sans-serif';
  g.fillText('示例', 790, 360);
  return c.toDataURL('image/png');
}
