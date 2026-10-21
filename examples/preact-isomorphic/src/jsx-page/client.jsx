import { render } from 'preact'
import { useState, useEffect } from 'preact/hooks'

/**
 * Simple JSX Client-Side Component Example
 *
 * This demonstrates a Preact component using JSX syntax that runs
 * exclusively on the client-side (browser). Unlike the isomorphic example,
 * this component is not pre-rendered on the server.
 */

// User profile card component
export const ProfileCard = ({ name, role, avatar, isActive }) => (
  <div className='profile-card'>
    <div className='profile-header'>
      <img
        src={avatar || 'https://placecats.com/64/64'}
        alt={`${name}'s avatar`}
        className='avatar'
      />
      <span className={`status-indicator ${isActive ? 'active' : 'inactive'}`} />
    </div>
    <div className='profile-info'>
      <h3>{name}</h3>
      <p className='role'>{role}</p>
    </div>
  </div>
)

// Main application component
export const Page = () => {
  // State for the counter
  const [count, setCount] = useState(0)

  // State for theme toggling
  const [darkMode, setDarkMode] = useState(false)

  // State for user profiles
  const [users, setUsers] = useState([
    { id: 1, name: 'Alex Johnson', role: 'Developer', isActive: true },
    { id: 2, name: 'Sam Taylor', role: 'Designer', isActive: false },
    { id: 3, name: 'Jordan Casey', role: 'Product Manager', isActive: true }
  ])

  // Effect to demonstrate client-side lifecycle
  useEffect(() => {
    console.log('Component mounted in the browser')

    // Update document title when count changes
    document.title = `Count: ${count}`

    return () => {
      console.log('Component will unmount')
    }
  }, [count])

  // Toggle a user's active status
  const toggleUserStatus = (userId) => {
    setUsers(users.map(user =>
      user.id === userId
        ? { ...user, isActive: !user.isActive }
        : user
    ))
  }

  return (
    <div className={`jsx-demo ${darkMode ? 'dark-theme' : 'light-theme'}`}>
      <h2>Client-Side JSX Rendering</h2>

      <div className='theme-toggle'>
        <button onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        </button>
      </div>

      <div className='counter-section'>
        <h3>Interactive Counter: {count}</h3>
        <div className='counter-controls'>
          <button onClick={() => setCount(count - 1)} disabled={count <= 0}>
            Decrement
          </button>
          <button onClick={() => setCount(0)}>
            Reset
          </button>
          <button onClick={() => setCount(count + 1)}>
            Increment
          </button>
        </div>
      </div>

      <div className='profiles-section'>
        <h3>User Profiles</h3>
        <p>Click on a profile to toggle active status:</p>
        <div className='profiles-grid'>
          {users.map(user => (
            <div key={user.id} onClick={() => toggleUserStatus(user.id)}>
              <ProfileCard {...user} />
            </div>
          ))}
        </div>
      </div>

      <div className='explanation'>
        <h3>How This Works</h3>
        <p>Unlike the isomorphic example, this component:</p>
        <ul>
          <li>Renders entirely on the client-side</li>
          <li>Uses native JSX syntax instead of HTM</li>
          <li>Mounts to an empty container in the HTML</li>
        </ul>
      </div>
    </div>
  )
}

// Mount the component to the DOM
const renderTarget = document.querySelector('.jsx-app')
if (renderTarget) {
  console.log({ renderTarget })
  render(<Page />, renderTarget)
}
