import { promises as fs } from 'fs';
import path from 'path';
import type { CourseTagDefinition, CourseTagId } from '@/lib/constants/course-tags';

export const COURSE_TAGS_FILE = path.join(process.cwd(), 'data', 'course-tags.json');

export async function readCourseTags(): Promise<CourseTagDefinition[]> {
  const content = await fs.readFile(COURSE_TAGS_FILE, 'utf-8');
  const parsed = JSON.parse(content) as CourseTagDefinition[];
  return Array.isArray(parsed) ? parsed : [];
}

export async function filterValidCourseTagIds(value: unknown): Promise<CourseTagId[]> {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags = await readCourseTags();
  const validIds = new Set(tags.map((tag) => tag.id));

  return value.filter(
    (item, index, array): item is CourseTagId =>
      typeof item === 'string' && validIds.has(item) && array.indexOf(item) === index,
  );
}

export async function resolveCourseTags(courseTagIds?: CourseTagId[]): Promise<CourseTagDefinition[]> {
  if (!courseTagIds || courseTagIds.length === 0) {
    return [];
  }

  const tags = await readCourseTags();
  const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
  return courseTagIds.map((id) => tagMap.get(id)).filter((tag): tag is CourseTagDefinition => !!tag);
}