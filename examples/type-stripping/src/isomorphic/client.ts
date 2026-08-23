import { html } from 'htm/preact'
import { render } from 'preact'
import { useState, useCallback, useEffect } from 'preact/hooks'

// ===== Type Definitions =====

interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
}

interface TaskFilterState {
  status: 'all' | 'active' | 'completed';
  priority: 'all' | 'low' | 'medium' | 'high';
}

interface TaskStats {
  total: number;
  active: number;
  completed: number;
  byPriority: {
    low: number;
    medium: number;
    high: number;
  };
}

// Component Props
interface TaskItemProps {
  task: Task;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

interface TaskFilterProps {
  filters: TaskFilterState;
  onFilterChange: (filters: Partial<TaskFilterState>) => void;
  stats: TaskStats;
}

interface TaskFormProps {
  onAddTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
}

interface TaskListProps {
  tasks: Task[];
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
}

// ===== Helper Functions =====

// Generate a unique ID (simplified version)
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
}

// Calculate task statistics
const calculateTaskStats = (tasks: Task[]): TaskStats => {
  const completed = tasks.filter(t => t.completed).length

  return {
    total: tasks.length,
    active: tasks.length - completed,
    completed,
    byPriority: {
      low: tasks.filter(t => t.priority === 'low').length,
      medium: tasks.filter(t => t.priority === 'medium').length,
      high: tasks.filter(t => t.priority === 'high').length
    }
  }
}

// Filter tasks based on current filters
const filterTasks = (tasks: Task[], filters: TaskFilterState): Task[] => {
  return tasks.filter(task => {
    // Filter by status
    if (filters.status === 'active' && task.completed) return false
    if (filters.status === 'completed' && !task.completed) return false

    // Filter by priority
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false

    return true
  })
}

// ===== Components =====

// Individual Task Item Component
const TaskItem = ({ task, onToggle, onDelete }: TaskItemProps) => {
  const getPriorityClass = (priority: Task['priority']): string => {
    switch (priority) {
      case 'high': return 'task-priority-high'
      case 'medium': return 'task-priority-medium'
      case 'low': return 'task-priority-low'
      default: return ''
    }
  }

  return html`
    <li class="task-item ${task.completed ? 'completed' : ''} ${getPriorityClass(task.priority)}">
      <div class="task-content">
        <input
          type="checkbox"
          checked=${task.completed}
          onChange=${() => onToggle(task.id)}
        />
        <span class="task-title">${task.title}</span>
        <span class="task-priority">${task.priority}</span>
      </div>
      <button class="delete-btn" onClick=${() => onDelete(task.id)}>Delete</button>
    </li>
  `
}

// Task Filter Component
const TaskFilter = ({ filters, onFilterChange, stats }: TaskFilterProps) => {
  return html`
    <div class="task-filters">
      <div class="filter-group">
        <h3>Filter by Status</h3>
        <div class="btn-group">
          <button
            class=${filters.status === 'all' ? 'active' : ''}
            onClick=${() => onFilterChange({ status: 'all' })}
          >
            All (${stats.total})
          </button>
          <button
            class=${filters.status === 'active' ? 'active' : ''}
            onClick=${() => onFilterChange({ status: 'active' })}
          >
            Active (${stats.active})
          </button>
          <button
            class=${filters.status === 'completed' ? 'active' : ''}
            onClick=${() => onFilterChange({ status: 'completed' })}
          >
            Completed (${stats.completed})
          </button>
        </div>
      </div>

      <div class="filter-group">
        <h3>Filter by Priority</h3>
        <div class="btn-group">
          <button
            class=${filters.priority === 'all' ? 'active' : ''}
            onClick=${() => onFilterChange({ priority: 'all' })}
          >
            All
          </button>
          <button
            class=${filters.priority === 'high' ? 'active' : ''}
            onClick=${() => onFilterChange({ priority: 'high' })}
          >
            High (${stats.byPriority.high})
          </button>
          <button
            class=${filters.priority === 'medium' ? 'active' : ''}
            onClick=${() => onFilterChange({ priority: 'medium' })}
          >
            Medium (${stats.byPriority.medium})
          </button>
          <button
            class=${filters.priority === 'low' ? 'active' : ''}
            onClick=${() => onFilterChange({ priority: 'low' })}
          >
            Low (${stats.byPriority.low})
          </button>
        </div>
      </div>
    </div>
  `
}

// Task Form Component
const TaskForm = ({ onAddTask }: TaskFormProps) => {
  const [error, setError] = useState<string | null>(null)

  // Simple approach using form submit
  const handleSubmit = (e: Event): void => {
    e.preventDefault()

    // Get form inputs directly
    const form = e.target as HTMLFormElement
    const titleInput = form.querySelector('input[name="title"]') as HTMLInputElement
    const prioritySelect = form.querySelector('select[name="priority"]') as HTMLSelectElement

    // Validate
    if (!titleInput || !titleInput.value.trim()) {
      setError('Task title cannot be empty')
      return
    }

    // Add task
    onAddTask({
      title: titleInput.value.trim(),
      completed: false,
      priority: prioritySelect.value as Task['priority']
    })

    // Reset form
    titleInput.value = ''
    prioritySelect.value = 'medium'
    setError(null)
  }

  return html`
    <form class="task-form" onSubmit=${handleSubmit}>
      <div class="form-group">
        <input
          type="text"
          name="title"
          placeholder="Add a new task..."
          class=${error ? 'error' : ''}
        />

        <select name="priority">
          <option value="low">Low Priority</option>
          <option value="medium" selected>Medium Priority</option>
          <option value="high">High Priority</option>
        </select>

        <button type="submit">
          Add Task
        </button>
      </div>

      ${error ? html`<p class="error-message">${error}</p>` : null}
    </form>
  `
}

// Task List Component
const TaskList = ({ tasks, onToggleTask, onDeleteTask }: TaskListProps) => {
  if (tasks.length === 0) {
    return html`<p class="no-tasks">No tasks to display</p>`
  }

  return html`
    <ul class="task-list">
      ${tasks.map(task => html`
        <${TaskItem}
          key=${task.id}
          task=${task}
          onToggle=${onToggleTask}
          onDelete=${onDeleteTask}
        />
      `)}
    </ul>
  `
}

// ===== Main Application =====

// Sample initial tasks
const initialTasks: Task[] = [
  {
    id: 'task-1',
    title: 'Learn TypeScript',
    completed: true,
    priority: 'high',
    createdAt: new Date()
  },
  {
    id: 'task-2',
    title: 'Build isomorphic app with DOMStack',
    completed: false,
    priority: 'medium',
    createdAt: new Date()
  },
  {
    id: 'task-3',
    title: 'Deploy application',
    completed: false,
    priority: 'low',
    createdAt: new Date()
  }
]

// Main TaskManager component
const TaskManager = () => {
  // TypeScript typed state
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [filters, setFilters] = useState<TaskFilterState>({
    status: 'all',
    priority: 'all'
  })

  // Memoized task stats
  const [stats, setStats] = useState<TaskStats>(calculateTaskStats(tasks))

  // Update stats when tasks change
  useEffect(() => {
    setStats(calculateTaskStats(tasks))
  }, [tasks])

  // Filter tasks based on current filters
  const filteredTasks = filterTasks(tasks, filters)

  // Event handlers with TypeScript types
  const handleAddTask = useCallback((newTask: Omit<Task, 'id' | 'createdAt'>): void => {
    const task: Task = {
      ...newTask,
      id: generateId(),
      createdAt: new Date()
    }

    setTasks(prevTasks => [...prevTasks, task])
  }, [])

  const handleToggleTask = useCallback((id: string): void => {
    setTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    )
  }, [])

  const handleDeleteTask = useCallback((id: string): void => {
    setTasks(prevTasks => prevTasks.filter(task => task.id !== id))
  }, [])

  const handleFilterChange = useCallback((newFilters: Partial<TaskFilterState>): void => {
    setFilters(prevFilters => ({ ...prevFilters, ...newFilters }))
  }, [])

  const handleClearCompleted = useCallback((): void => {
    setTasks(prevTasks => prevTasks.filter(task => !task.completed))
  }, [])

  // Data persistence - example of useEffect with TypeScript
  useEffect((): void => {
    // Only run in browser context
    if (typeof window !== 'undefined') {
      const savedTasks = localStorage.getItem('isomorphic-tasks')
      if (savedTasks) {
        try {
          // Parse and restore dates properly
          const parsedTasks = JSON.parse(savedTasks, (key, value) => {
            return key === 'createdAt' ? new Date(value) : value
          })
          setTasks(parsedTasks)
        } catch (err) {
          console.error('Failed to parse saved tasks:', err)
        }
      }
    }
  }, [])

  useEffect((): (() => void) | void => {
    // Only run in browser context
    if (typeof window !== 'undefined') {
      const handleSave = (): void => {
        localStorage.setItem('isomorphic-tasks', JSON.stringify(tasks))
      }

      // Save on page unload
      window.addEventListener('beforeunload', handleSave)

      // Clean up event listener
      return (): void => {
        window.removeEventListener('beforeunload', handleSave)
      }
    }
  }, [tasks])

  return html`
    <div class="task-manager">
      <header class="app-header">
        <h1>Isomorphic Task Manager</h1>
        <p>Demonstrating TypeScript with DOMStack</p>
      </header>

      <${TaskForm} onAddTask=${handleAddTask} />

      <${TaskFilter}
        filters=${filters}
        onFilterChange=${handleFilterChange}
        stats=${stats}
      />

      <${TaskList}
        tasks=${filteredTasks}
        onToggleTask=${handleToggleTask}
        onDeleteTask=${handleDeleteTask}
      />

      <div class="actions">
        <button
          class="clear-completed"
          onClick=${handleClearCompleted}
          disabled=${stats.completed === 0}
        >
          Clear Completed Tasks
        </button>
      </div>
    </div>
  `
}

// Export for isomorphic rendering
export const page = (): any => html`<${TaskManager} />`

// Client-side rendering
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const renderTarget = document.querySelector('.app-main')
      if (renderTarget) {
        render(page(), renderTarget)
      }
    })
  } else {
    const renderTarget = document.querySelector('.app-main')
    if (renderTarget) {
      render(page(), renderTarget)
    }
  }
}
