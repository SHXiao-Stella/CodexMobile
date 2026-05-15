import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopApprovalErrorView,
  desktopApprovalView
} from './desktop-approval-display.js';

test('desktopApprovalView prefers server display fields and falls back to legacy fields', () => {
  assert.deepEqual(desktopApprovalView({
    kind: 'command',
    summary: 'raw command',
    cwd: 'D:\\Project',
    display: {
      title: '需要批准命令',
      primary: 'Get-Date -Format o',
      secondary: 'PowerShell · D:\\Project'
    }
  }), {
    title: '需要批准命令',
    primary: 'Get-Date -Format o',
    secondary: 'PowerShell · D:\\Project'
  });

  assert.deepEqual(desktopApprovalView({
    kind: 'file',
    summary: 'Edit app.js',
    cwd: 'D:\\Project'
  }), {
    title: '需要批准文件修改',
    primary: 'Edit app.js',
    secondary: 'D:\\Project'
  });
});

test('desktopApprovalErrorView maps approval error codes to friendly UI behavior', () => {
  assert.deepEqual(desktopApprovalErrorView({ code: 'desktop_approval_stale' }), {
    code: 'desktop_approval_stale',
    title: '桌面端已处理',
    body: '桌面端已处理这条审批。',
    inline: '桌面端已处理这条审批。',
    removeApproval: true
  });
  assert.deepEqual(desktopApprovalErrorView({ code: 'desktop_approval_transient' }), {
    code: 'desktop_approval_transient',
    title: '审批暂时失败',
    body: '桌面端连接中断或超时，请稍后重试。',
    inline: '桌面端连接中断或超时，请稍后重试。',
    removeApproval: false
  });
  assert.deepEqual(desktopApprovalErrorView({ code: 'desktop_approval_failed' }), {
    code: 'desktop_approval_failed',
    title: '审批发送失败',
    body: '审批发送失败，请在电脑端处理。',
    inline: '审批发送失败，请在电脑端处理。',
    removeApproval: false
  });
});
