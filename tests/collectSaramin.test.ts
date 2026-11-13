import { describe, expect, it } from 'vitest'
import { getAdapter } from '../src/adapter/registry'
import { runAllSites } from '../src/engine/runAllSites'
import { criteria, freshStore } from './helpers'

function saraminHtml(
  items: Array<{ id: string; title: string; company: string; day: string; deadline?: string }>,
  totalCount: number,
): string {
  const rows = items
    .map(
      (i) => `
      <div class="item_recruit" value="${i.id}">
        <h2 class="job_tit"><a href="#">${i.title}</a></h2>
        <div class="corp_name"><a href="#">${i.company}</a></div>
        <div class="job_condition">
          <span><a href="#">서울</a> <a href="#">강남구</a></span>
          <span>경력무관</span>
        </div>
        <div class="job_sector"><a href="#">IT</a></div>
        <div class="job_date"><span class="date">${i.deadline ?? '상시채용'}</span><span class="job_day">${i.day}</span></div>
      </div>`,
    )
    .join('\n')
  return `<div id="recruit_info"><span class="cnt_result">총 ${totalCount}건</span></div><div id="recruit_info_list">${rows}</div>`
}

describe('collect with date-only precision and 수정일 markers (saramin)', () => {
  const saramin = getAdapter('saramin')!

  it('keeps same-day postings when cutoff has a later time of day, skips 수정일 known bumps, and stops on older days', async () => {
    const store = await freshStore()
    const baseCriteria = criteria({ keywords: ['전산'], locations: ['서울'], career: 'any' })

    const run1Html = saraminHtml([{ id: '100', title: '전산 초기 공고', company: '가회사', day: '등록일 26/11/12' }], 1)
    await runAllSites([saramin], baseCriteria, store, {
      fetchHtml: async () => run1Html,
      sleep: async () => {},
      now: new Date('2026-11-13T14:00:00+09:00'),
    })

    const fetchedPages: number[] = []
    const run2Page1 = saraminHtml(
      [
        { id: '100', title: '전산 초기 공고', company: '가회사', day: '수정일 26/11/13' },
        { id: '200', title: '전산 당일 신규 공고', company: '나회사', day: '등록일 26/11/13' },
        { id: '50', title: '전산 전날 공고', company: '다회사', day: '등록일 26/11/12' },
      ],
      80,
    )

    await runAllSites([saramin], baseCriteria, store, {
      fetchHtml: async (url) => {
        const page = Number(new URL(url).searchParams.get('recruitPage') ?? '1')
        fetchedPages.push(page)
        if (page === 1) return run2Page1
        throw new Error('should have stopped on older KST day on page 1')
      },
      sleep: async () => {},
      now: new Date('2026-11-13T18:00:00+09:00'),
    })

    expect(fetchedPages).toEqual([1])
    const saved = await store.listPostings('saramin')
    expect(saved.map((p) => p.externalId).sort()).toEqual(['100', '200'])
  })
})
