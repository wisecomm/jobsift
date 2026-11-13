import { z } from 'zod'

const queryValue = z.string().regex(/^[A-Za-z0-9,_-]+$/)

const searchParam = z.object({
  criterion: z.enum(['career']),
  query: z.string().min(1),
  values: z.object({
    any: queryValue.nullable(),
    new: queryValue.nullable(),
    experienced: queryValue.nullable(),
  }),
})

const nextFlightQuery = z.object({
  kind: z.literal('next-flight-query'),
  queryKey: z.string().min(1),
  itemsPath: z.string().min(1),
  totalPagesPath: z.string().min(1),
  fields: z.object({
    externalId: z.string().min(1),
    title: z.string().min(1),
    company: z.string().min(1),
    postedAt: z.string().min(1),
    deadline: z.string().min(1),
    careerCode: z.string().min(1),
    careerMinYears: z.string().min(1),
    areaCodes: z.string().min(1),
    jobTags: z.string().min(1),
  }),
  areaCodes: z.object({
    queryKey: z.string().min(1),
    tablePath: z.string().min(1),
    codeField: z.string().min(1),
    labelField: z.string().min(1),
  }),
  careerCodes: z.record(z.string(), z.enum(['new', 'any', 'experienced', 'newOrExperienced'])),
  careerMinYearsUnspecified: z.array(z.number()),
  jobTagsSeparator: z.string().min(1),
  noDeadlineFromYear: z.number().int(),
})

const regexString = z.string().min(1).refine(
  (s) => {
    try {
      new RegExp(s)
      return true
    } catch {
      return false
    }
  },
  '유효한 정규식이어야 합니다',
)

const htmlField = z.object({
  selector: z.string().min(1).optional(),
  attr: z.string().min(1).optional(),
  pattern: regexString.optional(),
})

const htmlSelectors = z.object({
  kind: z.literal('html-selectors'),
  readySelector: z.string().min(1),
  itemSelector: z.string().min(1),
  emptyItemSelector: z.string().min(1).optional(),
  totalCountSelector: z.string().min(1).optional(),
  fields: z.object({
    externalId: htmlField,
    title: htmlField,
    company: htmlField,
    postedAt: htmlField,
    deadline: htmlField.optional(),
  }),
  modifiedMarker: z.string().min(1).optional(),
  locationPartsSelector: z.string().min(1).optional(),
  inferLocationFromCompany: z.boolean().default(false),
  careerSelector: z.string().min(1).optional(),
  jobTagsSelector: z.string().min(1).optional(),
})

const extract = z.discriminatedUnion('kind', [nextFlightQuery, htmlSelectors])

export const siteAdapterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  homeUrl: z.string().url(),
  requiresLogin: z.boolean(),
  postedAtPrecision: z.enum(['datetime', 'date']).default('datetime'),
  version: z.number().int().positive(),
  search: z.object({
    urlTemplate: z
      .string()
      .url()
      .refine((t) => t.includes('{keyword}') && t.includes('{page}'), '{keyword}와 {page} 자리표시자가 필요합니다'),
    firstPage: z.number().int().min(0),
    pageSize: z.number().int().positive(),
    maxPages: z.number().int().positive(),
    requestDelayMs: z.number().int().min(0),
    params: z.array(searchParam),
  }),
  extract,
  postingUrlTemplate: z.string().url().refine((t) => t.includes('{id}'), '{id} 자리표시자가 필요합니다'),
})

export type SiteAdapter = z.infer<typeof siteAdapterSchema>
export type NextFlightQueryExtract = z.infer<typeof nextFlightQuery>
export type HtmlSelectorsExtract = z.infer<typeof htmlSelectors>
export type HtmlFieldRule = z.infer<typeof htmlField>

export function parseAdapter(json: unknown): SiteAdapter {
  return siteAdapterSchema.parse(json)
}
