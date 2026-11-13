import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: '채용공고 모음',
  version: '0.1.0',
  description: '내 PC에서 조건에 맞는 채용공고를 모아 보여줍니다.',
  permissions: ['storage'],
  host_permissions: ['https://www.jobkorea.co.kr/*', 'https://generativelanguage.googleapis.com/*'],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  action: { default_title: '채용공고 모음' },
})
