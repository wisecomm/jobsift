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

// A second member (kind: "html-selectors") joins here when the Saramin adapter lands.
const extract = z.discriminatedUnion('kind', [nextFlightQuery])

export const siteAdapterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  homeUrl: z.string().url(),
  requiresLogin: z.boolean(),
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

export function parseAdapter(json: unknown): SiteAdapter {
  return siteAdapterSchema.parse(json)
}
