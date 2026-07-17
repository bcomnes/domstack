/**
 * Global client-side TypeScript for React example
 * 
 * This file is loaded on all pages before any page-specific TypeScript.
 * It's a good place to add global event listeners, polyfills, or
 * other initialization code that should run on every page.
 */

// Define interfaces for our global utilities
interface DomstackUtils {
  formatDate(date: Date): string;
  getRandomItem<T>(array: T[]): T;
}

// Extend the Window interface to include our global utilities
interface Window {
  domstackUtils: DomstackUtils;
}

console.log('React example global client TypeScript loaded');

// Add a class to indicate JavaScript is enabled
document.documentElement.classList.add('js-enabled');

// Basic example of a global utility function
window.domstackUtils = {
  /**
   * Format a date in a human-readable format
   * @param date - The date to format
   * @returns Formatted date string
   */
  formatDate: (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  },
  
  /**
   * Get a random item from an array
   * @param array - The array to get a random item from
   * @returns A random item from the array
   */
  getRandomItem: <T>(array: T[]): T => {
    if (array.length === 0) {
      throw new Error("Cannot get random item from empty array");
    }
    const index = Math.floor(Math.random() * array.length);
    // This assertion is safe because we've checked that array is not empty
    return array[index] as T;
  }
};



// Example of measuring and logging performance
const pageLoadTime: number = performance.now();
window.addEventListener('load', (): void => {
  const totalLoadTime: number = performance.now() - pageLoadTime;
  console.log(`Page fully loaded in ${totalLoadTime.toFixed(2)}ms`);
});