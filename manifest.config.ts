import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'JobSift',
  version: '0.1.0',
  description: '내 PC에서 조건에 맞는 채용공고를 수집하고 AI로 선별해 보여줍니다.',
  permissions: ['storage'],
  host_permissions: [
    'https://www.jobkorea.co.kr/*',
    'https://www.saramin.co.kr/*',
    'https://www.gojobs.go.kr/*',
    'https://generativelanguage.googleapis.com/*',
    'https://api.exaone.ai/*',
  ],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  action: { default_title: 'JobSift' },
})
