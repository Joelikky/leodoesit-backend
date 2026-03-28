// test.js (Testing the Smart Invoice Generation)
fetch('http://localhost:5000/api/invoices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: "3dd2792a-c5a7-47a1-9e67-86164158a0c0",
      timesheet_id: "402495cb-f516-4efb-aab9-75d17af3c1df"
    })
  })
    .then(response => response.json())
    .then(data => console.log("Invoice Response:", data))
    .catch(error => console.error("Error:", error));



