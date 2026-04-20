export type CourseTagId = string;

export interface CourseTagDefinition {
  id: CourseTagId;
  tag_name: string;
  manager_ids: string[];
}