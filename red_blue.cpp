#include <iostream>
#include <vector>

using namespace std;

void dfs(int vertex, int parent, vector<bool> & used, vector< vector<char> > & graph, bool & has_cycle)
{
	used[vertex] = true;
	for (int neighbor = 0; neighbor < graph.size(); neighbor++)
    if (graph[vertex][neighbor] != '0')
        {
            if (!used[neighbor])
                dfs(neighbor, vertex, used, graph, has_cycle);
            else if(neighbor != parent)
            {
                has_cycle = 1;
                return ;
            }
        }
}

void print_graph(vector<vector<char>> graph)
{
    for (const auto &row : graph) {
        for ( const auto &c : row ) std::cout << c << ' ';
        std::cout << std::endl;
    }
}

int main() {
    int N;
    cin >> N;

    vector< vector<char> > graph(
        N,
        std::vector<char>(N, '0'));

    //print_graph(graph);

    for (int i = 0; i < graph.size() - 1; i++)
        for (int j = i + 1; j < graph.size(); j++)
            cin >> graph[i][j];

    for (int i = 0; i < graph.size() - 1; i++)
        for (int j = i + 1; j < graph.size(); j++)
            if (graph[i][j] == 'R') {
                graph[i][j] = '0';
                graph[j][i] = 'R';
            }
    
    bool has_cycle = 0;
    vector <bool> used( N );

    dfs(0, -1, used, graph, has_cycle);
    
    if (has_cycle == 1) {
        cout << "NO\n";
    } else {
        cout << "YES\n";
    }

    return EXIT_SUCCESS;
}
