/** A production workspace: raw script + its parsed skeleton. */
export interface Project {
  id: string
  title: string
  script_text: string
  schema_version: number
  created_at: number
  updated_at: number
}

export const SCHEMA_VERSION = 1
