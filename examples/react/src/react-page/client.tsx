import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

// Type definitions
interface CounterProps {
  initialValue?: number;
  label?: string;
}

// Simple counter component with React hooks
const Counter: React.FC<CounterProps> = ({ initialValue = 0, label = 'Counter Component' }) => {
  const [count, setCount] = useState<number>(initialValue)

  const increment = (): void => setCount(count + 1)
  const decrement = (): void => { if (count > 0) setCount(count - 1) }
  const reset = (): void => setCount(0)

  return (
    <div className='card'>
      <h3>{label}</h3>
      <p>Current count: <strong>{count}</strong></p>
      <div className='button-group'>
        <button className='button' onClick={decrement}>-</button>
        <button className='button' onClick={reset}>Reset</button>
        <button className='button' onClick={increment}>+</button>
      </div>
    </div>
  )
}

interface ThemeToggleProps {
  defaultDark?: boolean;
}

// Color theme toggle component
const ThemeToggle: React.FC<ThemeToggleProps> = ({ defaultDark = false }) => {
  const [isDark, setIsDark] = useState<boolean>(defaultDark)

  useEffect((): void => {
    if (isDark) {
      document.body.classList.add('dark-theme')
    } else {
      document.body.classList.remove('dark-theme')
    }
  }, [isDark])

  return (
    <div className='card'>
      <h3>Theme Toggle</h3>
      <p>Current theme: <strong>{isDark ? 'Dark' : 'Light'}</strong></p>
      <button
        className='button'
        onClick={(): void => setIsDark(!isDark)}
      >
        Switch to {isDark ? 'Light' : 'Dark'} Theme
      </button>
    </div>
  )
}

interface FormData {
  name: string;
  email: string;
  feedback: string;
}

// Form component with state
const SimpleForm: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    feedback: ''
  })
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    console.log('Form submitted:', formData)
    setIsSubmitted(true)

    // Reset form after 3 seconds
    setTimeout((): void => {
      setIsSubmitted(false)
      setFormData({
        name: '',
        email: '',
        feedback: ''
      })
    }, 3000)
  }

  return (
    <div className='card'>
      <h3>Simple Form</h3>

      {isSubmitted
        ? (
          <div className='success-message'>
            <p>Thanks for your feedback, {formData.name}!</p>
            <p>We'll be in touch at {formData.email}</p>
          </div>
          )
        : (
          <form onSubmit={handleSubmit}>
            <div>
              <label htmlFor='name'>Name</label>
              <input
                type='text'
                id='name'
                name='name'
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>

            <div>
              <label htmlFor='email'>Email</label>
              <input
                type='email'
                id='email'
                name='email'
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>

            <div>
              <label htmlFor='feedback'>Feedback</label>
              <textarea
                id='feedback'
                name='feedback'
                value={formData.feedback}
                onChange={handleChange}
                rows={3}
                required
              />
            </div>

            <button type='submit' className='button'>Submit Feedback</button>
          </form>
          )}
    </div>
  )
}

interface AppProps {
  title?: string;
}

// Main App component
const App: React.FC<AppProps> = ({ title = 'React Client-Side Rendering' }) => {
  const [time, setTime] = useState<Date>(new Date())

  // Update time every second
  useEffect((): (() => void) => {
    const timer = setInterval((): void => {
      setTime(new Date())
    }, 1000)

    return (): void => clearInterval(timer)
  }, [])

  return (
    <div className='react-demo'>
      <div className='react-header'>
        <img
          src='https://reactjs.org/logo-og.png'
          alt='React logo'
          className='react-logo'
          width='40'
          height='40'
        />
        <h2>{title}</h2>
      </div>

      <p>This component is rendered exclusively on the client-side using React with TypeScript.</p>
      <p>Current time: {time.toLocaleTimeString()}</p>

      <Counter initialValue={5} label='TypeScript Counter' />
      <ThemeToggle defaultDark={false} />
      <SimpleForm />

      <div className='info-panel'>
        <h3>About This Example</h3>
        <p>
          This example demonstrates how to use React with TypeScript in DOMStack by configuring
          ESBuild to use React's TSX transformer instead of Preact.
        </p>
        <p>
          Check out the <code>esbuild.settings.ts</code> file to see how this works!
        </p>
      </div>
    </div>
  )
}

// Mount the React app when the DOM is ready
document.addEventListener('DOMContentLoaded', (): void => {
  const container: HTMLElement | null = document.getElementById('react-root')
  if (container) {
    const root = createRoot(container)
    root.render(<App title='React + TypeScript Client-Side Rendering' />)
  }
})
