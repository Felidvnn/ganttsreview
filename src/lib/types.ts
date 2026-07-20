export type ProjectHealth = "healthy" | "risk" | "delayed";
export type TaskStatus = "todo" | "progress" | "review" | "done" | "blocked";

export type Person = {
  id: string;
  name: string;
  initials: string;
  role: "Líder" | "Ingeniero";
  color: string;
  email?: string;
  permission?: "owner" | "editor" | "viewer";
  directoryId?: string;
};

export type Project = {
  id: string;
  workspaceId?: string;
  createdBy?: string;
  name: string;
  code: string;
  description: string;
  progress: number;
  expectedProgress: number;
  health: ProjectHealth;
  dueLabel: string;
  dueDate: string;
  startDate?: string;
  startLabel?: string;
  color: string;
  members: Person[];
  tasksDone: number;
  tasksTotal: number;
  milestonesDone?: number;
  milestonesTotal?: number;
  blockedTasks?: number;
  visibility: "Colaborativo" | "Con líder" | "Privado";
  visibilityKey: "workspace" | "shared" | "private";
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  parentId?: string;
  rollupProgress?: boolean;
  owner: Person;
  owners?: Person[];
  start: number;
  duration: number;
  progress: number;
  priority?: 1 | 2 | 3;
  status: TaskStatus;
  due: string;
  startDate?: string;
  dueDate?: string;
  actualCompletionDate?: string;
  isMilestone?: boolean;
  color?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  directoryAssigneeIds?: string[];
  manualAssignee?: string;
  taskTypeId?: string;
  taskTypeName?: string;
  taskTypeColor?: string;
  overdue?: boolean;
  blockedBy?: string;
  section: string;
};

export type TaskDependency = {
  id: string;
  predecessorId: string;
  predecessorTitle: string;
  predecessorProject: string;
  predecessorStatus: TaskStatus;
  type: "finish_start" | "start_start" | "finish_finish" | "start_finish";
  lagDays: number;
};
