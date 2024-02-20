import axios from 'axios';

// YES THIS IS LESS THAN IDEAL
// BUT IT'S THE BEST WE CAN DO FOR NOW
// UNTIL PULUMI SUPPORTS THIS FUNCTIONALITY
// https://www.pulumi.com/docs/pulumi-cloud/cloud-rest-api/#create-environment
// https://github.com/pulumi/pulumi-pulumiservice/issues/225
export default function upsertEnvironment(data: string, organization: string, environment: string, token: string): void {

    const headers = {
        'Accept': 'application/vnd.pulumi+8',
        'Content-Type': 'text/plain',
        'Authorization': `token ${token}`,
    };
    // Doing a POST request to create the environment followed by a PATCH because of previews.
    axios.post(`https://api.pulumi.com/api/preview/environments/${organization}/${environment}`, data, { headers })
        .catch(error => {
          //  console.log("Error creating ESC Environment: " + environment);
        })
        .finally(() => {
            axios.patch(`https://api.pulumi.com/api/preview/environments/${organization}/${environment}`, data, { headers })
                .then(response => {
                    console.log("Created ESC Environment: " + environment);
                });
        });
}