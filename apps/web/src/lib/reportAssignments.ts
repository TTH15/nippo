/** 旧全体日報は便別日報が存在しない間だけ、コース全体をカバーする。 */
export function coversReportAssignment(reports: Set<string>, assignment: string): boolean {
  if (reports.has(assignment)) return true;
  const course = assignment.slice(0, assignment.lastIndexOf(":"));
  return reports.has(`${course}:0`) && ![...reports].some(key => key.startsWith(`${course}:`) && key !== `${course}:0`);
}
