import { render } from 'preact'
import { useState, useEffect } from 'preact/hooks'

// TypeScript interfaces for our component props
interface ButtonProps {
  onClick: () => void;
  variant: 'primary' | 'secondary' | 'danger';
  children: any;
  disabled?: boolean;
}

interface UserCardProps {
  id: number;
  name: string;
  email: string;
  role?: string;
}

// Styled button component with TypeScript props
const Button = ({ onClick, variant, children, disabled = false }: ButtonProps) => {
  // Compute classes based on variant
  const getButtonClass = (): string => {
    switch (variant) {
      case 'primary':
        return 'bg-blue-500 hover:bg-blue-700 text-white'
      case 'secondary':
        return 'bg-gray-500 hover:bg-gray-700 text-white'
      case 'danger':
        return 'bg-red-500 hover:bg-red-700 text-white'
      default:
        return 'bg-blue-500 hover:bg-blue-700 text-white'
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded font-bold ${getButtonClass()} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  )
}

// User card component with TypeScript props
const UserCard = ({ id, name, email, role = 'User' }: UserCardProps) => (
  <div className='border rounded p-4 mb-2 shadow hover:shadow-md transition-shadow'>
    <h3 className='font-bold'>{name}</h3>
    <p>ID: {id}</p>
    <p>Email: {email}</p>
    <p>Role: {role}</p>
  </div>
)

// Main application component with state management
export const Page = () => {
  // TypeScript typed state
  const [users, setUsers] = useState<UserCardProps[]>([
    { id: 1, name: 'John Doe', email: 'john@example.com', role: 'Admin' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
  ])

  const [count, setCount] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  // TypeScript void return type
  const incrementCounter = (): void => {
    setCount(prev => prev + 1)
  }

  // Add a new user with TypeScript type safety
  const addUser = (): void => {
    setIsLoading(true)

    // Simulate API call
    setTimeout(() => {
      const newUser: UserCardProps = {
        id: users.length + 1,
        name: `User ${users.length + 1}`,
        email: `user${users.length + 1}@example.com`
      }

      setUsers([...users, newUser])
      setIsLoading(false)
    }, 500)
  }

  // TypeScript with useEffect
  useEffect((): void => {
    document.title = `${count} clicks`
  }, [count])

  return (
    <div className='p-4 max-w-md mx-auto'>
      <h1 className='text-2xl font-bold mb-4'>TypeScript JSX Example</h1>

      <div className='mb-6'>
        <p className='mb-2'>Counter: {count}</p>
        <Button onClick={incrementCounter} variant='primary'>
          Increment
        </Button>
      </div>

      <div className='mb-6'>
        <h2 className='text-xl font-bold mb-2'>Users</h2>
        {users.map(user => (
          <UserCard key={user.id} {...user} />
        ))}

        <div className='mt-4'>
          <Button
            onClick={addUser}
            variant='secondary'
            disabled={isLoading}
          >
            {isLoading ? 'Adding...' : 'Add Random User'}
          </Button>
        </div>
      </div>

      <Button onClick={() => setUsers([])} variant='danger'>
        Clear All Users
      </Button>
    </div>
  )
}

// TypeScript DOM null check
const renderTarget = document.querySelector('.jsx-app')
if (renderTarget) {
  render(<Page />, renderTarget)
}
